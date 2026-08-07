import { create } from 'zustand'
import { temporal } from 'zundo'
import { applyNodeChanges, applyEdgeChanges, addEdge as rfAddEdge } from '@xyflow/react'
import type { Node as RFNode, Edge as RFEdge, NodeChange, EdgeChange, Connection } from '@xyflow/react'

// The canvas's own working state -- deliberately a separate zustand store
// from src/store.ts (which holds cross-view app state: actions, activity).
// This one is scoped to CompositionCanvas.tsx's lifetime and wrapped in
// zundo's temporal middleware for undo/redo, which src/store.ts has no
// need for.
export interface CanvasNodeData extends Record<string, unknown> {
  nodeTypeID: string
  kind: string
  label: string
  config: Record<string, string>
}

export type CanvasNode = RFNode<CanvasNodeData>

interface CanvasState {
  nodes: CanvasNode[]
  edges: RFEdge[]
  onNodesChange: (changes: NodeChange<CanvasNode>[]) => void
  onEdgesChange: (changes: EdgeChange[]) => void
  onConnect: (connection: Connection) => void
  addNode: (node: CanvasNode) => void
  updateNodeConfig: (id: string, key: string, value: string) => void
  removeSelected: () => void
  load: (nodes: CanvasNode[], edges: RFEdge[]) => void
  clear: () => void
}

// isValidConnection (CompositionCanvas.tsx) already rejects a second
// outgoing edge before onConnect fires -- addEdge here is the trusted
// last step, not a second enforcement point.
export const useCanvasStore = create<CanvasState>()(
  temporal(
    (set, get) => ({
      nodes: [],
      edges: [],
      onNodesChange: (changes) => set({ nodes: applyNodeChanges(changes, get().nodes) }),
      onEdgesChange: (changes) => set({ edges: applyEdgeChanges(changes, get().edges) }),
      onConnect: (connection) => set({ edges: rfAddEdge(connection, get().edges) }),
      addNode: (node) => set({ nodes: [...get().nodes, node] }),
      updateNodeConfig: (id, key, value) =>
        set({
          nodes: get().nodes.map((n) =>
            n.id === id ? { ...n, data: { ...n.data, config: { ...n.data.config, [key]: value } } } : n,
          ),
        }),
      removeSelected: () =>
        set((s) => {
          const removedIds = new Set(s.nodes.filter((n) => n.selected).map((n) => n.id))
          return {
            nodes: s.nodes.filter((n) => !n.selected),
            edges: s.edges.filter((e) => !e.selected && !removedIds.has(e.source) && !removedIds.has(e.target)),
          }
        }),
      load: (nodes, edges) => set({ nodes, edges }),
      clear: () => set({ nodes: [], edges: [] }),
    }),
    {
      // Only {nodes, edges} are undo-worthy graph state -- nothing else
      // lives in this store, but partialize is explicit anyway so a
      // future field addition doesn't silently join the undo stack.
      partialize: (state) => ({ nodes: state.nodes, edges: state.edges }),
      limit: 50,
    },
  ),
)
