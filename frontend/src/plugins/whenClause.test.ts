import { describe, expect, it } from 'vitest'
import { evaluateWhen, parseWhen, tokenizeWhen, whenClauseError } from './whenClause'

// The `when` expression language (docs/goals/0380 Decision 4). Two
// properties matter and neither is provable by reading the grammar: an
// expression is TOKENISED, so an operator character inside a fact
// value is a value and not an operator; and a broken expression hides
// its own item instead of taking a menu down.

const FACTS = {
  objectKind: 'ink',
  objectPluginId: 'mill-drawing',
  selectionCount: 2,
  selectionKinds: ['ink', 'shape'],
  hasFile: true,
  hasSize: false,
  editRoute: 'none',
  'payload.title': 'Sketch && Notes',
}

describe('when clauses', () => {
  it('reads a bare fact as a truth test, absent and empty both false', () => {
    expect(evaluateWhen('hasFile', FACTS)).toBe(true)
    expect(evaluateWhen('hasSize', FACTS)).toBe(false)
    expect(evaluateWhen('neverDeclared', FACTS)).toBe(false)
    expect(evaluateWhen('true', FACTS)).toBe(true)
    expect(evaluateWhen('false', FACTS)).toBe(false)
  })

  it('compares, negates, groups, and honours precedence over && before ||', () => {
    expect(evaluateWhen("objectKind == 'ink'", FACTS)).toBe(true)
    expect(evaluateWhen("objectKind != 'ink'", FACTS)).toBe(false)
    expect(evaluateWhen('selectionCount > 1', FACTS)).toBe(true)
    expect(evaluateWhen('selectionCount >= 3', FACTS)).toBe(false)
    expect(evaluateWhen('!hasSize', FACTS)).toBe(true)
    expect(evaluateWhen("hasSize && hasFile || objectKind == 'ink'", FACTS)).toBe(true)
    expect(evaluateWhen("hasSize && (hasFile || objectKind == 'ink')", FACTS)).toBe(false)
  })

  it("tests membership with `in` against a list fact", () => {
    expect(evaluateWhen("'shape' in selectionKinds", FACTS)).toBe(true)
    expect(evaluateWhen("'card' in selectionKinds", FACTS)).toBe(false)
    expect(evaluateWhen("'card' in objectKind", FACTS)).toBe(false)
  })

  // The property a pattern over the expression cannot hold: a value
  // carrying an operator is compared as a value, because the operator
  // characters were never reachable as tokens inside a quoted string.
  it('treats operator characters inside a quoted value as data, not as operators', () => {
    expect(evaluateWhen("payload.title == 'Sketch && Notes'", FACTS)).toBe(true)
    expect(evaluateWhen("payload.title == 'Sketch'", FACTS)).toBe(false)
    expect(tokenizeWhen("payload.title == 'a || b'")).toEqual([
      { t: 'name', v: 'payload.title' },
      { t: 'op', v: '==' },
      { t: 'string', v: 'a || b' },
    ])
  })

  it('hides an item whose expression is broken, rather than throwing into the menu', () => {
    expect(evaluateWhen('hasFile &&', FACTS)).toBe(false)
    expect(evaluateWhen('(hasFile', FACTS)).toBe(false)
    expect(evaluateWhen('', FACTS)).toBe(false)
    expect(evaluateWhen("'unterminated", FACTS)).toBe(false)
  })

  it('reports the same breakage by name for the conformance check', () => {
    expect(whenClauseError("objectKind == 'ink'")).toBeNull()
    expect(whenClauseError('hasFile &&')).toContain('ends early')
    expect(whenClauseError('(hasFile')).toContain('missing ")"')
    expect(whenClauseError('hasFile hasSize')).toContain('trailing input')
  })

  it('parses into a tree a reader can walk, never a matched string', () => {
    expect(parseWhen("a && b == 'c'")).toEqual({
      n: 'and',
      left: { n: 'fact', name: 'a' },
      right: { n: 'cmp', op: '==', left: { n: 'fact', name: 'b' }, right: { n: 'const', value: 'c' } },
    })
  })
})
