import type { Edge as RFEdge } from '@xyflow/react'
import type { Node as CompNode, Edge as CompEdge, Note as CompNote } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import type { CanvasNode, CanvasNoteNode } from './canvasStore'
import { CANVAS_NOTE_WIDTH, CANVAS_NOTE_HEIGHT } from './canvasConstants'

// Converts the canvas's own React Flow node/edge shape into the Go wire
// shape (composition.Node/Edge) CreateWorkflow/UpdateWorkflow/
// ValidateDraft all receive -- shared by CompositionCanvas.tsx's save()
// and useDraftValidation.ts's debounced live-validation call so the two
// can never drift into building the draft two different ways.
export function toDraftNodes(nodes: CanvasNode[]): CompNode[] {
  return nodes.map((n) => ({
    ID: n.id,
    // Kind is server-derived and overwritten by ResolveNodeDefaults
    // regardless of what the client sends (composition.go's own doc
    // comment on Node.Kind) -- CanvasNodeData.kind is deliberately a
    // loose string, not the generated NodeKind enum, so this mirrors
    // the same `as CompNode[]` cast every existing save-path caller
    // already applies after its own zod parse.
    Kind: n.data.kind as CompNode['Kind'],
    NodeTypeID: n.data.nodeTypeID,
    Config: n.data.config,
    Position: { X: n.position.x, Y: n.position.y },
  }))
}

export function toDraftEdges(edges: RFEdge[]): CompEdge[] {
  return edges.map((e) => ({
    ID: e.id,
    Source: e.source,
    SourceHandle: (e.data as { condition?: string } | undefined)?.condition ?? '',
    Target: e.target,
  }))
}

// Converts the canvas's own note nodes into the Go wire shape
// (composition.Note, docs/goals/0055) -- shared by useCanvasSave.ts's
// UpdateNotes call and canvasScratch.ts's hot-exit dirty check, same
// role toDraftNodes/toDraftEdges already play for steps. Width/height
// fall back to the note's default box when React Flow hasn't measured
// a resize yet (a brand-new note, before NodeResizer ever fires).
export function toDraftNotes(notes: CanvasNoteNode[]): CompNote[] {
  return notes.map((n) => ({
    ID: n.id,
    Text: n.data.text,
    Position: { X: n.position.x, Y: n.position.y },
    Size: { Width: n.width ?? CANVAS_NOTE_WIDTH, Height: n.height ?? CANVAS_NOTE_HEIGHT },
    Color: n.data.color as CompNote['Color'],
  }))
}
