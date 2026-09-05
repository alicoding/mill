// The tree model behind shared/JsonTree.tsx (goal 0326): what a parsed
// JSON value looks like as rows, what each row's path is, and which
// containers a find query has to open. Pure, so every rule is unit
// tested without mounting Primer's TreeView.

export type JsonNodeKind = 'object' | 'array' | 'primitive'

export interface JsonNode {
  // The dotted/bracketed accessor a reader can paste into a
  // filter, an attribute expression, or another tool: the shape
  // browsers' own object inspectors copy.
  path: string
  // The row's own label before the value: an object member's key, an
  // array member's index.
  key: string
  value: unknown
  kind: JsonNodeKind
  childCount: number
}

export const ROOT_PATH = '$'

export function kindOf(value: unknown): JsonNodeKind {
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'object' && value !== null) return 'object'
  return 'primitive'
}

// A key that is a plain identifier reads as `.name`; anything else has
// to be quoted, the same rule a JavaScript accessor follows. An EMPTY
// parent is the root-less variant (goal 0269's board face, matching the
// browser inspectors' own "Copy property path": `workstreams[0].owner`,
// no root token) -- the first identifier segment then carries no
// leading dot.
export function joinPath(parent: string, key: string, inArray: boolean): string {
  if (inArray) return `${parent}[${key}]`
  const identifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
  if (!parent) return identifier ? key : `[${JSON.stringify(key)}]`
  return identifier ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`
}

export function childrenOf(value: unknown, path: string): JsonNode[] {
  if (Array.isArray(value)) {
    return value.map((child, index) => ({
      path: joinPath(path, String(index), true),
      key: String(index),
      value: child,
      kind: kindOf(child),
      childCount: countOf(child),
    }))
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value as Record<string, unknown>).map(([key, child]) => ({
      path: joinPath(path, key, false),
      key,
      value: child,
      kind: kindOf(child),
      childCount: countOf(child),
    }))
  }
  return []
}

export function countOf(value: unknown): number {
  if (Array.isArray(value)) return value.length
  if (typeof value === 'object' && value !== null) return Object.keys(value as object).length
  return 0
}

// What a collapsed container shows instead of its contents: the count,
// in its own brackets, so an array and an object never read alike. An
// empty container has no count to give and reads as the bare brackets
// -- the same `{}` / `[]` every object inspector shows, and the row
// that must never grow a chevron promising contents it doesn't have.
export function containerSummary(node: JsonNode): string {
  const inner = node.childCount === 0 ? '' : String(node.childCount)
  return node.kind === 'array' ? `[${inner}]` : `{${inner}}`
}

// The rendering class a primitive's value takes (goal 0269 rule 7):
// type is carried by how the value is PAINTED -- quoted green strings,
// accent numbers, a distinct tone for the two value-less literals --
// never by a badge next to it, the convention every browser inspector
// converged on.
export type JsonValueKind = 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array'

export function valueKind(value: unknown): JsonValueKind {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) return 'array'
  switch (typeof value) {
    case 'string': return 'string'
    case 'number':
    case 'bigint': return 'number'
    case 'boolean': return 'boolean'
    default: return 'object'
  }
}

// A primitive's rendered value. A string keeps its quotes so an empty
// string, a numeric string and a number stay distinguishable.
export function primitiveLabel(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  return String(value)
}

// The text a row copies: a container copies its whole subtree as JSON,
// a primitive copies its bare value (a string without its quotes --
// what a reader wants on the clipboard).
export function nodeCopyText(node: JsonNode): string {
  if (node.kind === 'primitive') return typeof node.value === 'string' ? node.value : primitiveLabel(node.value)
  try {
    return JSON.stringify(node.value, null, 2)
  } catch {
    return String(node.value)
  }
}

export function allContainerPaths(value: unknown, path = ROOT_PATH, out: string[] = []): string[] {
  for (const child of childrenOf(value, path)) {
    if (child.kind !== 'primitive') {
      out.push(child.path)
      allContainerPaths(child.value, child.path, out)
    }
  }
  return out
}

function rowText(node: JsonNode): string {
  return node.kind === 'primitive' ? `${node.key} ${primitiveLabel(node.value)}` : node.key
}

export function nodeMatches(node: JsonNode, query: string): boolean {
  return rowText(node).toLowerCase().includes(query.toLowerCase())
}

// Every container that has to open for a find hit to be visible: a hit
// deep inside three collapsed objects opens all three, which is what
// "searches collapsed content too" means.
export function pathsToExpandFor(value: unknown, query: string, path = ROOT_PATH, out: Set<string> = new Set()): Set<string> {
  if (query === '') return out
  for (const child of childrenOf(value, path)) {
    const deep = child.kind === 'primitive' ? new Set<string>() : pathsToExpandFor(child.value, query, child.path)
    if (nodeMatches(child, query) || deep.size > 0 || (child.kind !== 'primitive' && subtreeMatches(child, query))) {
      if (child.kind !== 'primitive') out.add(child.path)
      for (const p of deep) out.add(p)
    }
  }
  return out
}

// Whether anything BELOW this row matches -- the second half of "keep
// this row" for a surface that hides non-matching rows rather than
// merely highlighting them (goal 0269's filter, as against the Output
// viewer's find).
export function subtreeMatches(node: JsonNode, query: string): boolean {
  for (const child of childrenOf(node.value, node.path)) {
    if (nodeMatches(child, query)) return true
    if (child.kind !== 'primitive' && subtreeMatches(child, query)) return true
  }
  return false
}

// Every row of the tree, keyed by its own path -- what a surface tracking
// the FOCUSED row resolves a `data-path` attribute back into (goal 0269's
// copy commands, which are handed the row rather than re-deriving it).
export function nodesByPath(value: unknown, path = ROOT_PATH, out: Map<string, JsonNode> = new Map()): Map<string, JsonNode> {
  for (const child of childrenOf(value, path)) {
    out.set(child.path, child)
    if (child.kind !== 'primitive') nodesByPath(child.value, child.path, out)
  }
  return out
}

// How many rows a query matches, counted over the WHOLE tree including
// collapsed containers -- the number the find summary states, so "no
// matches" is a fact about the data and never about what happens to be
// open.
export function matchCount(value: unknown, query: string, path = ROOT_PATH): number {
  if (query === '') return 0
  let found = 0
  for (const child of childrenOf(value, path)) {
    if (nodeMatches(child, query)) found++
    if (child.kind !== 'primitive') found += matchCount(child.value, query, child.path)
  }
  return found
}

// The container paths open on arrival: every container shallower than
// `depth`. Depth 1 opens the root's own children, depth 2 also opens
// theirs -- enough structure to read the shape without the whole file
// unrolled (goal 0269).
export function pathsToDepth(value: unknown, depth: number, path = ROOT_PATH, level = 1, out: string[] = []): string[] {
  if (level > depth) return out
  for (const child of childrenOf(value, path)) {
    if (child.kind === 'primitive' || child.childCount === 0) continue
    out.push(child.path)
    pathsToDepth(child.value, depth, child.path, level + 1, out)
  }
  return out
}
