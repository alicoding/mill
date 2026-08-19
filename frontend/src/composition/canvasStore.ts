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
  // What payload leaves this step (NodeType.Output) -- kept for the
  // card's hover title only; the on-card LINE itself is contractLine
  // below (ADR-0042 §4).
  output?: string
  // The step I/O contract's compact "takes -> produces" string
  // (payloadKinds.ts's contractLine, ADR-0042 §4) -- cached onto the
  // node the same way output above is, at creation/type-change/load
  // time, since contractLine is a pure function of the node's OWN
  // NodeType (never the graph position), unlike the effective payload
  // kind a connection's compatibility check resolves separately.
  contractLine?: string
  // The step's current guardrail verdict ('ask' | 'deny' | 'allow'),
  // injected by CompositionCanvas from GuardrailService.WorkflowVerdicts
  // -- the nothing-hidden rule (docs/adr/0022's Update): a step that
  // will pause or refuse is marked on the canvas BEFORE anyone runs it.
  guardrailEffect?: string
  guardrailRule?: string
  // Source distinguishes a breakpoint's ask ('debug') from a policy
  // ask/deny ('' -- docs/adr/0031): CanvasNodeView renders a distinct
  // debug badge instead of the guardrail shield when this is 'debug',
  // so the two never read as one concept ("recognition, not
  // confirmation").
  guardrailSource?: string
  // This node's own authoring-validation issues (docs/adr/0028),
  // injected by CompositionCanvas from useDraftValidation's debounced
  // ValidateDraft call -- the same nothing-hidden pattern as
  // guardrailEffect above, applied to save-blocking/informational
  // problems instead of execution policy. 'error' wins over 'warning'
  // when a node carries both (CanvasNodeView badges the worse one).
  validationIssues?: { severity: string; message: string }[]
}

export type CanvasNode = RFNode<CanvasNodeData>

// A note (docs/goals/0055) is a distinct React Flow node TYPE, not a
// step -- it renders through CanvasNoteView, never CanvasNodeView, has
// no ports/Kind/nodeTypeID, and never appears in toDraftNodes' output
// (draftPayload.ts only ever reads the `nodes` slice below, never
// `notes`). Size lives in RFNode's own top-level width/height (not
// inside `data`): NodeResizer's resize changes arrive as a 'dimensions'
// NodeChange that applyNodeChanges (onNotesChange below) writes onto
// those two fields directly, so no separate size-sync code is needed.
export interface CanvasNoteData extends Record<string, unknown> {
  text: string
  color: string
}

export type CanvasNoteNode = RFNode<CanvasNoteData>

export interface CanvasState {
  nodes: CanvasNode[]
  edges: RFEdge[]
  notes: CanvasNoteNode[]
  onNodesChange: (changes: NodeChange<CanvasNode>[]) => void
  onEdgesChange: (changes: EdgeChange[]) => void
  onNotesChange: (changes: NodeChange<CanvasNoteNode>[]) => void
  onConnect: (connection: Connection) => void
  addNode: (node: CanvasNode) => void
  addNote: (note: CanvasNoteNode) => void
  updateNoteText: (id: string, text: string) => void
  updateNoteColor: (id: string, color: string) => void
  changeNodeType: (id: string, nodeTypeID: string, label: string, config: Record<string, string>, output?: string, contractLine?: string) => void
  updateNodeConfig: (id: string, key: string, value: string) => void
  updateEdgeCondition: (id: string, condition: string) => void
  removeSelected: () => void
  // One node by id (goal 0075's context-menu Delete) -- same edge/
  // cleanup contract as removeSelected, without touching selection.
  removeNode: (id: string) => void
  // One edge by id (goal 0075's edge context-menu Delete connection) --
  // the edge-only counterpart to removeNode above, no node/notes cleanup.
  removeEdge: (id: string) => void
  load: (nodes: CanvasNode[], edges: RFEdge[]) => void
  loadNotes: (notes: CanvasNoteNode[]) => void
  setGuardrailVerdicts: (verdicts: Record<string, { effect: string; ruleLabel: string; source?: string }>) => void
  setValidationIssues: (issuesByNodeId: Record<string, { severity: string; message: string }[]>) => void
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
//
// initialNodes/initialEdges (docs/goals/0012-authoring-hot-exit.md):
// seeded directly into the store's own creation rather than via a
// follow-up `load()` call, so the very first render already reflects
// either the saved workflow, the new-workflow starter node, or a
// restored hot-exit scratch -- CompositionCanvas.tsx's caller computes
// which one applies (readScratch/draftsEqual, canvasScratch.ts) before
// this factory ever runs, so there's no async catch-up render where
// `nodes`/`edges` would transiently read stale/empty. Since this is
// part of the store's initial state object, not a `set()` call, zundo's
// temporal middleware never records it onto the undo stack -- no
// `.temporal.getState().clear()` needed afterward, unlike the old
// `load()`-based mount effect this replaced.
export function createCanvasStore(initialNodes: CanvasNode[] = [], initialEdges: RFEdge[] = [], initialNotes: CanvasNoteNode[] = []) {
  return create<CanvasState>()(
    temporal(
      (set, get) => ({
        nodes: initialNodes,
        edges: initialEdges,
        notes: initialNotes,
        onNodesChange: (changes) => set({ nodes: applyNodeChanges(changes, get().nodes) }),
        onEdgesChange: (changes) => set({ edges: applyEdgeChanges(changes, get().edges) }),
        onNotesChange: (changes) => set({ notes: applyNodeChanges(changes, get().notes) }),
        onConnect: (connection) => set({ edges: rfAddEdge(connection, get().edges) }),
        addNode: (node) => set({ nodes: [...get().nodes, node] }),
        addNote: (note) => set({ notes: [...get().notes, note] }),
        updateNoteText: (id, text) =>
          set({ notes: get().notes.map((n) => (n.id === id ? { ...n, data: { ...n.data, text } } : n)) }),
        updateNoteColor: (id, color) =>
          set({ notes: get().notes.map((n) => (n.id === id ? { ...n, data: { ...n.data, color } } : n)) }),
        // Swaps an already-placed node to a different NodeType of the
        // *same* Kind, in place -- id/position/edges untouched, only
        // nodeTypeID/label/config change. This is what lets "I meant
        // hotkey, not manual" be a Select in the Inspector instead of
        // delete-the-node-and-drag-a-new-one, the friction a real user
        // hit (docs/SPEC.md §3). Kind never changes here (the Inspector
        // only offers same-Kind options), so isValidConnection's
        // per-kind edge rules and any existing edges stay valid
        // untouched.
        changeNodeType: (id, nodeTypeID, label, config, output, contractLine) =>
          set({
            nodes: get().nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, nodeTypeID, label, config, output: output ?? '', contractLine: contractLine ?? '' } } : n)),
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
              notes: s.notes.filter((n) => !n.selected),
            }
          }),
        removeNode: (id) =>
          set((s) => ({
            nodes: s.nodes.filter((n) => n.id !== id),
            edges: s.edges.filter((e) => e.source !== id && e.target !== id),
          })),
        removeEdge: (id) => set((s) => ({ edges: s.edges.filter((e) => e.id !== id) })),
        load: (nodes, edges) => set({ nodes, edges }),
        loadNotes: (notes) => set({ notes }),
        setGuardrailVerdicts: (verdicts) =>
          set({
            nodes: get().nodes.map((n) => {
              const v = verdicts[n.id]
              const effect = v?.effect === 'ask' || v?.effect === 'deny' ? v.effect : undefined
              const source = effect ? v?.source : undefined
              if (
                (n.data.guardrailEffect ?? undefined) === effect &&
                (!effect || (n.data.guardrailRule === v?.ruleLabel && n.data.guardrailSource === source))
              ) return n
              return { ...n, data: { ...n.data, guardrailEffect: effect, guardrailRule: v?.ruleLabel, guardrailSource: source } }
            }),
          }),
        setValidationIssues: (issuesByNodeId) =>
          set({
            nodes: get().nodes.map((n) => {
              const next = issuesByNodeId[n.id]
              const prev = n.data.validationIssues
              if (JSON.stringify(prev ?? []) === JSON.stringify(next ?? [])) return n
              return { ...n, data: { ...n.data, validationIssues: next } }
            }),
          }),
        clear: () => set({ nodes: [], edges: [], notes: [] }),
      }),
      {
        // {nodes, edges, notes} are the undo-worthy canvas state -- a
        // note drag/resize/edit undoes the same way a step edit does
        // (docs/goals/0055: notes are authoring-space content, not a
        // second-class citizen of the undo stack).
        partialize: (state) => ({ nodes: state.nodes, edges: state.edges, notes: state.notes }),
        limit: 50,
      },
    ),
  )
}

export type CanvasStore = ReturnType<typeof createCanvasStore>
