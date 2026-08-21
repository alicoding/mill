import type { Edge as RFEdge } from '@xyflow/react'
import type { CanvasNode, CanvasNoteNode } from './canvasStore'

// The workflow canvas's clone payload (docs/goals/0153): what ⌘C
// serializes to the system clipboard and ⌘V materializes back. Plain
// readable JSON deliberately -- pasteable into a text editor,
// shareable across workflows and instances. Carries no secrets by
// construction: step config holds Configure entity IDs; secret values
// live in the keychain and never enter node config.
export interface WorkflowClonePayload {
  mill: 'clone'
  surface: 'workflow'
  v: 1
  nodes: { data: CanvasNode['data']; dx: number; dy: number; width?: number; height?: number }[]
  notes: { data: CanvasNoteNode['data']; dx: number; dy: number; width?: number; height?: number }[]
  // Endpoint indexes into nodes above -- set-scoped by construction
  // (an edge to anything outside the copied set is never serialized;
  // the researched rule: no dangling connections, ever).
  edges: { source: number; target: number; sourceHandle?: string | null; targetHandle?: string | null; label?: unknown; data?: RFEdge['data'] }[]
}

// serializeCanvasSelection builds the payload from the current
// selection. Trigger steps never copy (a workflow has exactly one
// trigger); an edge comes along only when BOTH its endpoints are in
// the copied set. Returns null when nothing copyable is selected.
export function serializeCanvasSelection(nodes: CanvasNode[], edges: RFEdge[], notes: CanvasNoteNode[]): WorkflowClonePayload | null {
  const pickedNodes = nodes.filter((n) => n.selected && n.data.kind !== 'trigger')
  const pickedNotes = notes.filter((n) => n.selected)
  if (pickedNodes.length === 0 && pickedNotes.length === 0) return null

  const all = [...pickedNodes, ...pickedNotes]
  const minX = Math.min(...all.map((n) => n.position.x))
  const minY = Math.min(...all.map((n) => n.position.y))
  const indexByID = new Map(pickedNodes.map((n, i) => [n.id, i]))

  return {
    mill: 'clone',
    surface: 'workflow',
    v: 1,
    nodes: pickedNodes.map((n) => ({
      data: n.data, dx: n.position.x - minX, dy: n.position.y - minY,
      ...(n.width ? { width: n.width } : {}), ...(n.height ? { height: n.height } : {}),
    })),
    notes: pickedNotes.map((n) => ({
      data: n.data, dx: n.position.x - minX, dy: n.position.y - minY,
      ...(n.width ? { width: n.width } : {}), ...(n.height ? { height: n.height } : {}),
    })),
    edges: edges
      .filter((e) => indexByID.has(e.source) && indexByID.has(e.target))
      .map((e) => ({
        source: indexByID.get(e.source)!, target: indexByID.get(e.target)!,
        sourceHandle: e.sourceHandle, targetHandle: e.targetHandle,
        ...(e.label !== undefined ? { label: e.label } : {}),
        ...(e.data !== undefined ? { data: e.data } : {}),
      })),
  }
}

// parseWorkflowClonePayload recognizes clipboard text as this
// surface's own payload -- anything else (other JSON, prose, another
// surface's envelope) returns null and falls through to whatever the
// caller does with ordinary clipboard content.
export function parseWorkflowClonePayload(text: string): WorkflowClonePayload | null {
  try {
    const parsed = JSON.parse(text) as WorkflowClonePayload
    if (parsed && parsed.mill === 'clone' && parsed.surface === 'workflow' && Array.isArray(parsed.nodes) && Array.isArray(parsed.notes) && Array.isArray(parsed.edges)) return parsed
  } catch {
    // not JSON -- ordinary clipboard content
  }
  return null
}

// materializeCanvasClones turns a payload into ready-to-add store
// entries: fresh IDs, absolute positions anchored so the payload's
// top-left lands at `at` (paste-at-cursor, the goal's own grammar),
// everything selected so the pasted set is immediately the live
// selection.
export function materializeCanvasClones(payload: WorkflowClonePayload, at: { x: number; y: number }, newID: () => string): { nodes: CanvasNode[]; edges: RFEdge[]; notes: CanvasNoteNode[] } {
  const nodeIDs = payload.nodes.map(() => newID())
  const nodes: CanvasNode[] = payload.nodes.map((n, i) => ({
    id: nodeIDs[i],
    // A step node's RF type is its KIND string (canvasConversion.ts's
    // own mapping) -- the per-kind node component registry key.
    type: n.data.kind,
    position: { x: at.x + n.dx, y: at.y + n.dy },
    data: { ...n.data },
    selected: true,
    ...(n.width ? { width: n.width } : {}), ...(n.height ? { height: n.height } : {}),
  }))
  const notes: CanvasNoteNode[] = payload.notes.map((n) => ({
    id: newID(),
    type: 'note',
    position: { x: at.x + n.dx, y: at.y + n.dy },
    data: { ...n.data },
    selected: true,
    ...(n.width ? { width: n.width } : {}), ...(n.height ? { height: n.height } : {}),
  }))
  const edges: RFEdge[] = payload.edges
    .filter((e) => nodeIDs[e.source] !== undefined && nodeIDs[e.target] !== undefined)
    .map((e) => ({
      id: newID(),
      source: nodeIDs[e.source], target: nodeIDs[e.target],
      sourceHandle: e.sourceHandle ?? null, targetHandle: e.targetHandle ?? null,
      ...(e.label !== undefined ? { label: e.label as RFEdge['label'] } : {}),
      ...(e.data !== undefined ? { data: e.data } : {}),
    }))
  return { nodes, edges, notes }
}
