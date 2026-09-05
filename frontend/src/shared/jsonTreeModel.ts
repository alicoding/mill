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
// to be quoted, the same rule a JavaScript accessor follows.
export function joinPath(parent: string, key: string, inArray: boolean): string {
  if (inArray) return `${parent}[${key}]`
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`
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
// in its own brackets, so an array and an object never read alike.
export function containerSummary(node: JsonNode): string {
  return node.kind === 'array' ? `[${node.childCount}]` : `{${node.childCount}}`
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

function subtreeMatches(node: JsonNode, query: string): boolean {
  for (const child of childrenOf(node.value, node.path)) {
    if (nodeMatches(child, query)) return true
    if (child.kind !== 'primitive' && subtreeMatches(child, query)) return true
  }
  return false
}
