import type { Edge as RFEdge } from '@xyflow/react'
import type { Node as CompNode, Edge as CompEdge } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import type { CanvasNode } from './canvasStore'

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
