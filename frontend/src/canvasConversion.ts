import type { Edge as RFEdge } from '@xyflow/react'
import type { NodeType, Node as CompNode, Edge as CompEdge } from '../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import type { CanvasNode } from './canvasStore'

// Converts a persisted Workflow's Nodes/Edges (Wails' PascalCase wire
// shape) into React Flow's own node/edge shape, for loading an existing
// workflow onto the canvas to edit -- the inverse of save()'s mapping
// in CompositionCanvas.tsx. nodeTypes supplies each node's display label,
// since a stored Node only carries NodeTypeID, not the type's own Label.
export function toCanvasNodes(nodes: CompNode[] | null, nodeTypes: NodeType[]): CanvasNode[] {
  return (nodes ?? []).map((n) => {
    const nt = nodeTypes.find((t) => t.ID === n.NodeTypeID)
    const config: Record<string, string> = {}
    for (const [k, v] of Object.entries(n.Config ?? {})) {
      if (v !== undefined) config[k] = v
    }
    return {
      id: n.ID,
      type: n.Kind,
      position: { x: n.Position?.X ?? 0, y: n.Position?.Y ?? 0 },
      data: { nodeTypeID: n.NodeTypeID, kind: n.Kind, label: nt?.Label ?? n.NodeTypeID, config },
    }
  })
}

export function toRFEdges(edges: CompEdge[] | null): RFEdge[] {
  return (edges ?? []).map((e) => ({ id: e.ID, source: e.Source, target: e.Target, sourceHandle: e.SourceHandle || undefined }))
}
