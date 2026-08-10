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
  // What payload leaves this step (NodeType.Output) -- the on-card
  // output signature (docs/SPEC.md §3.8's authoring-style direction).
  output?: string
  // The step's current guardrail verdict ('ask' | 'deny' | 'allow'),
  // injected by CompositionCanvas from GuardrailService.WorkflowVerdicts
  // -- the nothing-hidden rule (docs/adr/0022's Update): a step that
  // will pause or refuse is marked on the canvas BEFORE anyone runs it.
  guardrailEffect?: string
  guardrailRule?: string
}

export type CanvasNode = RFNode<CanvasNodeData>

interface CanvasState {
  nodes: CanvasNode[]
  edges: RFEdge[]
  onNodesChange: (changes: NodeChange<CanvasNode>[]) => void
  onEdgesChange: (changes: EdgeChange[]) => void
  onConnect: (connection: Connection) => void
  addNode: (node: CanvasNode) => void
  changeNodeType: (id: string, nodeTypeID: string, label: string, config: Record<string, string>, output?: string) => void
  updateNodeConfig: (id: string, key: string, value: string) => void
  updateEdgeCondition: (id: string, condition: string) => void
  removeSelected: () => void
  load: (nodes: CanvasNode[], edges: RFEdge[]) => void
  setGuardrailVerdicts: (verdicts: Record<string, { effect: string; ruleLabel: string }>) => void
  clear: () => void
}

// isValidConnection (CompositionCanvas.tsx) already rejects a second
// outgoing edge before onConnect fires -- addEdge here is the trusted
// last step, not a second enforcement point.
//
// A factory, not a module-level singleton: tabbed multi-editing
// (CompositionView.tsx) can have several workflows open on the canvas
// at once, each needing its own independent nodes/edges/undo history.
// CompositionCanvas.tsx calls this once per mounted instance
// (`useState(() => createCanvasStore())`), so every other line that
// already reads `useCanvasStore(...)`/`.getState()`/`.temporal` keeps
// working unchanged -- a component-scoped store has the identical API
// surface as the old module-level one.
export function createCanvasStore() {
  return create<CanvasState>()(
    temporal(
      (set, get) => ({
        nodes: [],
        edges: [],
        onNodesChange: (changes) => set({ nodes: applyNodeChanges(changes, get().nodes) }),
        onEdgesChange: (changes) => set({ edges: applyEdgeChanges(changes, get().edges) }),
        onConnect: (connection) => set({ edges: rfAddEdge(connection, get().edges) }),
        addNode: (node) => set({ nodes: [...get().nodes, node] }),
        // Swaps an already-placed node to a different NodeType of the
        // *same* Kind, in place -- id/position/edges untouched, only
        // nodeTypeID/label/config change. This is what lets "I meant
        // hotkey, not manual" be a Select in the Inspector instead of
        // delete-the-node-and-drag-a-new-one, the friction a real user
        // hit (docs/SPEC.md §3). Kind never changes here (the Inspector
        // only offers same-Kind options), so isValidConnection's
        // per-kind edge rules and any existing edges stay valid
        // untouched.
        changeNodeType: (id, nodeTypeID, label, config, output) =>
          set({
            nodes: get().nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, nodeTypeID, label, config, output: output ?? '' } } : n)),
          }),
        updateNodeConfig: (id, key, value) =>
          set({
            nodes: get().nodes.map((n) =>
              n.id === id ? { ...n, data: { ...n.data, config: { ...n.data.config, [key]: value } } } : n,
            ),
          }),
        // A Decision edge's condition lives in edge.data, not edge.sourceHandle
        // -- CanvasNodeView's single, unnamed source Handle means
        // sourceHandle has no real matching id to give React Flow, and
        // setting it to an arbitrary expr-lang string would silently
        // break edge rendering. label mirrors it so the condition (or
        // "otherwise") is visible directly on the canvas, not just in
        // the Inspector. See ruleTranslate.ts's own doc comment.
        updateEdgeCondition: (id, condition) =>
          set({
            edges: get().edges.map((e) =>
              e.id === id ? { ...e, data: { ...e.data, condition }, label: condition } : e,
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
        setGuardrailVerdicts: (verdicts) =>
          set({
            nodes: get().nodes.map((n) => {
              const v = verdicts[n.id]
              const effect = v?.effect === 'ask' || v?.effect === 'deny' ? v.effect : undefined
              if ((n.data.guardrailEffect ?? undefined) === effect && (!effect || n.data.guardrailRule === v?.ruleLabel)) return n
              return { ...n, data: { ...n.data, guardrailEffect: effect, guardrailRule: v?.ruleLabel } }
            }),
          }),
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
}

export type CanvasStore = ReturnType<typeof createCanvasStore>
