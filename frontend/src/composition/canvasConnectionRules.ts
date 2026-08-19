import type { Connection, Edge as RFEdge } from '@xyflow/react'
import type { NodeType } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import type { CanvasNode } from './canvasStore'
import { consumesAccepts, describeConsumes, describeKind, effectivePayloadKind, type EffectiveKindEdge } from './payloadKinds'

// The draw-time mirror of the backend's buildGraph out-degree/root
// rules (composition.go) -- "a save-time error and a run-time error
// never disagree." Extracted out of CompositionCanvas.tsx as a pure,
// independently testable function once wiring the step-detail
// overlay's open affordance (docs/goals/0058) pushed that file over
// the 500-line convention (CLAUDE.md).
export function isValidCanvasConnection(nodes: CanvasNode[], edges: RFEdge[], connection: Connection | RFEdge): boolean {
  const source = nodes.find((n) => n.id === connection.source)
  // A terminal node (docs/adr/0027) may have NO outgoing edge at all --
  // checked before the out-degree-1 rule below, since "at most 1" would
  // otherwise let exactly one edge out of a Decision through. Matches
  // CanvasNodeView omitting its source handle entirely; this is the
  // draw-time layer of the same rule, belt-and-suspenders with the
  // missing handle. Every node kind except Decision is max-out-degree-1
  // -- a Decision node's whole purpose is multiple named outgoing
  // branches (SPEC.md §3.5), the one kind exempt from the limit.
  if (source?.data.kind === 'terminal') return false
  if (source?.data.kind !== 'decision' && edges.some((e) => e.source === connection.source)) return false
  // Nothing connects into a trigger node -- it's the entry point, not a
  // step something else feeds (matches CanvasNodeView omitting the
  // target handle for trigger nodes; this is the draw-time layer of the
  // same rule, belt-and-suspenders with the missing handle).
  const target = nodes.find((n) => n.id === connection.target)
  if (target?.data.kind === 'trigger') return false
  return true
}

// connectionRefusalReason is the step I/O contract's draw-time mirror
// of ValidateGraph's payload-kind check (ADR-0042 §3, payloadkind.go).
// Null means the connection is allowed (structurally invalid
// connections already rejected above never get a text reason -- the
// existing trigger/out-degree rules stay silently refused, unchanged).
// A non-null return means the connection should ALSO be refused for a
// KIND reason: CompositionCanvas.tsx's isValidConnection callback
// folds this in (structural OK AND this returns null), and the same
// string drives the transient on-canvas explanation.
export function connectionRefusalReason(
  nodes: CanvasNode[],
  edges: RFEdge[],
  connection: Connection | RFEdge,
  nodeTypesById: Map<string, NodeType>,
): string | null {
  if (!isValidCanvasConnection(nodes, edges, connection)) return null
  const source = nodes.find((n) => n.id === connection.source)
  const target = nodes.find((n) => n.id === connection.target)
  if (!source || !target) return null
  const targetType = nodeTypesById.get(target.data.nodeTypeID)
  if (!targetType || !targetType.Consumes || targetType.Consumes.length === 0) return null

  // effectivePayloadKind needs each node pre-joined to its NodeType --
  // this module has no registry of its own (see payloadKinds.ts).
  const typesByNodeId: Record<string, NodeType | undefined> = {}
  for (const n of nodes) typesByNodeId[n.id] = nodeTypesById.get(n.data.nodeTypeID)
  const incoming: Record<string, EffectiveKindEdge[]> = {}
  for (const e of edges) {
    (incoming[e.target] ??= []).push({ source: e.source })
  }

  const produced = effectivePayloadKind(source.id, typesByNodeId, incoming, new Set())
  if (consumesAccepts(targetType.Consumes, produced)) return null
  return `${target.data.label} needs ${describeConsumes(targetType.Consumes)}, but the step before it produces ${describeKind(produced)}.`
}
