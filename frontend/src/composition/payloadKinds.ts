import type { NodeType } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'

// The draw-time mirror of internal/domain/composition/payloadkind.go
// (ADR-0042) -- every function here reproduces that file's semantics
// exactly, so a save-time Go refusal and a draw-time TS refusal never
// disagree. PayloadKind stays a plain string here (not the generated
// enum) since these functions operate on data pulled out of NodeType
// fields that are themselves typed against the enum already; a plain
// string keeps the signatures matching payloadkind.go's own Go
// signatures 1:1.

// kindAccepts mirrors payloadkind.go's unexported kindAccepts: any
// accepts everything, a concrete kind accepts itself, and text accepts
// every concrete text kind (html/markdown/json). none as a consumer
// kind is handled by consumesAccepts, not here.
function kindAccepts(c: string, p: string): boolean {
  if (c === 'any' || p === 'any') return true
  if (c === p) return true
  if (c === 'text' && (p === 'html' || p === 'markdown' || p === 'json')) return true
  return false
}

// consumesAccepts mirrors ConsumesAccepts: a producer of none is
// universally accepted (an entry point's empty payload is legal input
// everywhere); a consumer whose Consumes is exactly [none] accepts
// everything (it ignores the payload); none inside a longer Consumes
// list is skipped (display-honesty, not a validation distinction).
export function consumesAccepts(consumes: string[], produced: string): boolean {
  if (produced === 'none') return true
  if (consumes.length === 1 && consumes[0] === 'none') return true
  for (const c of consumes) {
    if (c === 'none') continue
    if (kindAccepts(c, produced)) return true
  }
  return false
}

export interface EffectiveKindEdge {
  source: string
}

// effectivePayloadKind mirrors EffectivePayloadKind: walks back through
// passthrough node types to the nearest real producer. nodeTypesById
// maps a canvas node's id straight to its already-resolved NodeType --
// this module has no NodeType registry lookup of its own the way
// payloadkind.go's package-level nodeType() does, so the caller
// pre-joins each node id to its type before calling in. Unknown node,
// unresolved type, a cycle, or an empty produce kind all resolve to
// "any" -- never a false refusal.
export function effectivePayloadKind(
  nodeId: string,
  nodeTypesById: Record<string, NodeType | undefined>,
  incomingEdges: Record<string, EffectiveKindEdge[]>,
  visited: Set<string>,
): string {
  if (visited.has(nodeId)) return 'any'
  visited.add(nodeId)
  const nt = nodeTypesById[nodeId]
  if (!nt) return 'any'
  if (!nt.Produces.passthrough) {
    return nt.Produces.kind ? nt.Produces.kind : 'any'
  }
  for (const e of incomingEdges[nodeId] ?? []) {
    const k = effectivePayloadKind(e.source, nodeTypesById, incomingEdges, visited)
    if (k !== 'any') return k
  }
  return 'any'
}

// describeKind mirrors describeKind: the human vocabulary for a coarse
// payload kind, shared by the canvas card, the Inspector, the palette
// tooltip, and the draw-time refusal hint so all four surfaces use
// identical wording for the same kind.
export function describeKind(k: string): string {
  switch (k) {
    case 'none':
      return 'nothing'
    case 'any':
      return 'anything'
    case 'html':
      return 'HTML'
    case 'json':
      return 'JSON'
    case 'markdown':
      return 'Markdown'
    case 'text':
      return 'text'
    default:
      return k
  }
}

// describeConsumes mirrors describeConsumes: joins a Consumes
// declaration into one phrase, skipping none entries (display-honesty
// only), single-entry lists render as just that kind's name.
export function describeConsumes(kinds: string[]): string {
  if (kinds.length === 0) return 'anything'
  if (kinds.length === 1) return describeKind(kinds[0])
  const named = kinds.filter((k) => k !== 'none').map(describeKind)
  return named.length > 0 ? named.join(' or ') : 'nothing'
}

// The produced half of contractLine: passthrough always reads
// "unchanged"; a none produce kind reads "starts empty" for a trigger
// (the run's own entry point) and "nothing" for every other Kind.
function describeProduced(nt: NodeType): string {
  if (nt.Produces.passthrough) return 'unchanged'
  const kind = nt.Produces.kind || 'none'
  if (kind === 'none') {
    return nt.Kind === 'trigger' ? 'starts empty' : 'nothing'
  }
  return describeKind(kind)
}

// contractLine is the compact "takes -> produces" string rendered on
// the canvas card and the palette tooltip (ADR-0042 §4). A step whose
// Consumes is exactly [none] renders arrow-only (nothing worth naming
// on the input side); every other step names both sides.
export function contractLine(nt: NodeType): string {
  const consumes = nt.Consumes ?? []
  const produced = describeProduced(nt)
  if (consumes.length === 1 && consumes[0] === 'none') {
    return `→ ${produced}`
  }
  return `${describeConsumes(consumes)} → ${produced}`
}
