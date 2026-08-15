import type { Connection, Edge as RFEdge } from '@xyflow/react'
import type { CanvasNode } from './canvasStore'

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
