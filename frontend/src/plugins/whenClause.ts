// The `when` expression language (docs/goals/0380 Decision 4): the
// converged extension-menu shape -- a declared boolean expression over
// facts the HOST computes, evaluated host-side, never a callback into
// the extension. A sandboxed extension cannot answer a synchronous
// "should this item show?" at all, and an asynchronous answer would
// open the menu before the answer arrived, so enablement is declared
// once and decided by whoever already holds the facts.
//
// The expression is TOKENISED AND PARSED into a tree, never matched:
// a pattern over an expression language answers wrongly the first time
// a fact value contains an operator character.
//
// Supported, in precedence order: parentheses, `!`, comparisons
// (`==` `!=` `<` `<=` `>` `>=` `in`), `&&`, `||`. Operands are
// identifiers (a fact name, dotted for a payload key), single- or
// double-quoted strings, numbers, and `true`/`false`.

export type WhenValue = string | number | boolean | readonly string[]
export type WhenFacts = Readonly<Record<string, WhenValue>>

export class WhenSyntaxError extends Error {
  constructor(detail: string) {
    super(detail)
    this.name = 'WhenSyntaxError'
  }
}

type Token =
  | { t: 'op'; v: string }
  | { t: 'name'; v: string }
  | { t: 'string'; v: string }
  | { t: 'number'; v: number }

const OPERATORS = ['&&', '||', '==', '!=', '<=', '>=', '!', '<', '>', '(', ')']
const NAME_START = /[A-Za-z_]/
const NAME_REST = /[A-Za-z0-9_.-]/
const DIGIT = /[0-9]/

function isSpace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r'
}

function readQuoted(src: string, start: number): { value: string; next: number } {
  const quote = src[start]
  let i = start + 1
  let out = ''
  while (i < src.length && src[i] !== quote) {
    out += src[i]
    i += 1
  }
  if (i >= src.length) throw new WhenSyntaxError('an unterminated string')
  return { value: out, next: i + 1 }
}

function readWhile(src: string, start: number, allowed: RegExp): { value: string; next: number } {
  let i = start
  while (i < src.length && allowed.test(src[i])) i += 1
  return { value: src.slice(start, i), next: i }
}

export function tokenizeWhen(src: string): Token[] {
  const out: Token[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (isSpace(ch)) { i += 1; continue }
    if (ch === '"' || ch === "'") {
      const read = readQuoted(src, i)
      out.push({ t: 'string', v: read.value })
      i = read.next
      continue
    }
    const op = OPERATORS.find((candidate) => src.startsWith(candidate, i))
    if (op) { out.push({ t: 'op', v: op }); i += op.length; continue }
    if (DIGIT.test(ch)) {
      const read = readWhile(src, i, /[0-9.]/)
      out.push({ t: 'number', v: Number(read.value) })
      i = read.next
      continue
    }
    if (NAME_START.test(ch)) {
      const read = readWhile(src, i, NAME_REST)
      out.push({ t: 'name', v: read.value })
      i = read.next
      continue
    }
    throw new WhenSyntaxError(`an unexpected character "${ch}"`)
  }
  return out
}

// A cursor over the token list: the parser below is a plain recursive
// descent, one function per precedence level, so the grammar reads off
// the code in the order the header states it.
class Cursor {
  private at = 0
  constructor(private readonly tokens: Token[]) {}
  peek(): Token | undefined { return this.tokens[this.at] }
  take(): Token | undefined { return this.tokens[this.at++] }
  eatOp(v: string): boolean {
    const tok = this.peek()
    if (tok && tok.t === 'op' && tok.v === v) { this.at += 1; return true }
    return false
  }
  peekOp(...vs: string[]): string | null {
    const tok = this.peek()
    return tok && tok.t === 'op' && vs.includes(tok.v) ? tok.v : null
  }
  done(): boolean { return this.at >= this.tokens.length }
}

export type WhenNode =
  | { n: 'or'; left: WhenNode; right: WhenNode }
  | { n: 'and'; left: WhenNode; right: WhenNode }
  | { n: 'not'; inner: WhenNode }
  | { n: 'cmp'; op: string; left: WhenNode; right: WhenNode }
  | { n: 'fact'; name: string }
  | { n: 'const'; value: WhenValue }

function parseOr(c: Cursor): WhenNode {
  let left = parseAnd(c)
  while (c.eatOp('||')) left = { n: 'or', left, right: parseAnd(c) }
  return left
}

function parseAnd(c: Cursor): WhenNode {
  let left = parseCmp(c)
  while (c.eatOp('&&')) left = { n: 'and', left, right: parseCmp(c) }
  return left
}

const COMPARISONS = ['==', '!=', '<=', '>=', '<', '>']

function parseCmp(c: Cursor): WhenNode {
  const left = parseUnary(c)
  const op = c.peekOp(...COMPARISONS)
  if (op) { c.take(); return { n: 'cmp', op, left, right: parseUnary(c) } }
  const next = c.peek()
  if (next && next.t === 'name' && next.v === 'in') { c.take(); return { n: 'cmp', op: 'in', left, right: parseUnary(c) } }
  return left
}

function parseUnary(c: Cursor): WhenNode {
  if (c.eatOp('!')) return { n: 'not', inner: parseUnary(c) }
  return parsePrimary(c)
}

function parsePrimary(c: Cursor): WhenNode {
  if (c.eatOp('(')) {
    const inner = parseOr(c)
    if (!c.eatOp(')')) throw new WhenSyntaxError('a missing ")"')
    return inner
  }
  const tok = c.take()
  if (!tok) throw new WhenSyntaxError('an expression that ends early')
  if (tok.t === 'string') return { n: 'const', value: tok.v }
  if (tok.t === 'number') return { n: 'const', value: tok.v }
  if (tok.t === 'name') {
    if (tok.v === 'true') return { n: 'const', value: true }
    if (tok.v === 'false') return { n: 'const', value: false }
    return { n: 'fact', name: tok.v }
  }
  throw new WhenSyntaxError(`an unexpected "${tok.v}"`)
}

export function parseWhen(src: string): WhenNode {
  const c = new Cursor(tokenizeWhen(src))
  if (c.done()) throw new WhenSyntaxError('an empty expression')
  const node = parseOr(c)
  if (!c.done()) throw new WhenSyntaxError('trailing input after the expression')
  return node
}

// truthy follows the same rule the source language does: absent, an
// empty string, 0 and false are all false; everything else is true. An
// undeclared fact is absent, never an error -- a menu item written
// against a fact this Mill version does not compute stays hidden
// rather than breaking the whole menu.
function truthy(value: WhenValue | undefined): boolean {
  if (value === undefined) return false
  if (Array.isArray(value)) return value.length > 0
  return Boolean(value)
}

function compare(op: string, left: WhenValue | undefined, right: WhenValue | undefined): boolean {
  if (op === 'in') return Array.isArray(right) ? right.includes(String(left)) : false
  if (op === '==') return String(left) === String(right)
  if (op === '!=') return String(left) !== String(right)
  const a = Number(left)
  const b = Number(right)
  if (Number.isNaN(a) || Number.isNaN(b)) return false
  if (op === '<') return a < b
  if (op === '<=') return a <= b
  if (op === '>') return a > b
  return a >= b
}

function value(node: WhenNode, facts: WhenFacts): WhenValue | undefined {
  switch (node.n) {
    case 'const': return node.value
    case 'fact': return facts[node.name]
    default: return evaluateNode(node, facts)
  }
}

function evaluateNode(node: WhenNode, facts: WhenFacts): boolean {
  switch (node.n) {
    case 'or': return evaluateNode(node.left, facts) || evaluateNode(node.right, facts)
    case 'and': return evaluateNode(node.left, facts) && evaluateNode(node.right, facts)
    case 'not': return !evaluateNode(node.inner, facts)
    case 'cmp': return compare(node.op, value(node.left, facts), value(node.right, facts))
    case 'fact': return truthy(facts[node.name])
    default: return truthy(node.value)
  }
}

// evaluateWhen is the door every seat calls. A malformed expression is
// FALSE, not a thrown error: one plugin's typo must never take a menu
// down, and the plugin's own status note already names the problem
// (whenClauseError below is what the conformance check reports).
export function evaluateWhen(expression: string, facts: WhenFacts): boolean {
  try {
    return evaluateNode(parseWhen(expression), facts)
  } catch {
    return false
  }
}

// whenClauseError is the same parse, reported rather than swallowed --
// for the manifest conformance check and the Extensions row.
export function whenClauseError(expression: string): string | null {
  try {
    parseWhen(expression)
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}
