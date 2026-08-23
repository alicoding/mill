import { create } from 'zustand'
import { temporal } from 'zundo'
import { applyNodeChanges, applyEdgeChanges, addEdge as rfAddEdge } from '@xyflow/react'
import type { Node as RFNode, Edge as RFEdge, NodeChange, EdgeChange, Connection } from '@xyflow/react'
import { OTHERWISE_HANDLE } from './ruleTranslate'

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
  // Branch rows added via the Rules panel's "Add rule" control before
  // their edge is drawn (docs/goals/0173): a count per Decision node id
  // of how many of its NEXT directly-drawn outgoing edges should land
  // as plain rules rather than claim the auto-fallback below. Excluded
  // from zundo's partialize (undo/redo tracks graph content, not this
  // in-progress authoring intent).
  pendingRuleClaims: Record<string, number>
  onNodesChange: (changes: NodeChange<CanvasNode>[]) => void
  onEdgesChange: (changes: EdgeChange[]) => void
  onNotesChange: (changes: NodeChange<CanvasNoteNode>[]) => void
  onConnect: (connection: Connection) => void
  addNode: (node: CanvasNode) => void
  addNote: (note: CanvasNoteNode) => void
  // Pasted clones arrive already selected (goal 0153) -- everything
  // previously selected deselects so the pasted set IS the selection.
  addClones: (clones: { nodes: CanvasNode[]; edges: RFEdge[]; notes: CanvasNoteNode[] }) => void
  updateNoteText: (id: string, text: string) => void
  updateNoteColor: (id: string, color: string) => void
  changeNodeType: (id: string, nodeTypeID: string, label: string, config: Record<string, string>, output?: string, contractLine?: string) => void
  updateNodeConfig: (id: string, key: string, value: string) => void
  updateEdgeCondition: (id: string, condition: string) => void
  // A Decision edge's label alone (docs/goals/0173's Rules panel row) --
  // independent of its condition, unlike updateEdgeCondition which also
  // mirrors the condition onto the label as its default display text.
  updateEdgeLabel: (id: string, label: string) => void
  // Rewrites evaluation order for one Decision node's outgoing edges
  // (docs/goals/0173): orderedEdgeIds is that node's edges in the new
  // desired order. Reassigns the edge OBJECTS occupying that node's
  // existing array slots, so every other node's edges (and their own
  // relative order) are untouched -- nextNode (graph.go) reads first-
  // match-wins purely off array order, so this IS what changes which
  // rule a run checks first.
  reorderDecisionEdges: (nodeId: string, orderedEdgeIds: string[]) => void
  // Claims one of this Decision node's next directly-drawn edges as a
  // plain rule (Rules panel's "Add rule" control, docs/goals/0173) --
  // see pendingRuleClaims above.
  armPendingBranchRule: (nodeId: string) => void
  // Cancels one unwired pending claim (the Rules panel's own cancel
  // affordance on a not-yet-wired rule) -- floored at zero.
  disarmPendingBranchRule: (nodeId: string) => void
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
  const store = create<CanvasState>()(
    temporal(
      (set, get) => ({
        nodes: initialNodes,
        edges: initialEdges,
        notes: initialNotes,
        pendingRuleClaims: {},
        onNodesChange: (changes) => set({ nodes: applyNodeChanges(changes, get().nodes) }),
        onEdgesChange: (changes) => set({ edges: applyEdgeChanges(changes, get().edges) }),
        onNotesChange: (changes) => set({ notes: applyNodeChanges(changes, get().notes) }),
        onConnect: (connection) =>
          set((s) => {
            const edges = rfAddEdge(connection, s.edges)
            const newEdge = edges[edges.length - 1]
            const claims = s.pendingRuleClaims[newEdge.source] ?? 0
            if (claims > 0) {
              return { edges, pendingRuleClaims: { ...s.pendingRuleClaims, [newEdge.source]: claims - 1 } }
            }
            // A Branch node's mandatory fallback (composition.go's
            // otherwiseHandle/ValidateGraph's otherwiseCount check): the
            // first outgoing edge drawn directly on canvas, with no
            // pending rule claim, becomes this node's otherwise edge
            // when it doesn't have one yet -- a fresh Branch reaches a
            // valid, save-ready state as soon as any route exists,
            // without the user needing to know to mark one explicitly.
            // Never touches a node that already has an otherwise edge
            // (existing seeded/authored graphs are unaffected).
            const sourceNode = s.nodes.find((n) => n.id === newEdge.source)
            const hasOtherwise = s.edges.some(
              (e) => e.source === newEdge.source && (e.data as { condition?: string } | undefined)?.condition === OTHERWISE_HANDLE,
            )
            if (sourceNode?.data.kind === 'decision' && !hasOtherwise) {
              return {
                edges: edges.map((e) =>
                  e.id === newEdge.id ? { ...e, data: { ...e.data, condition: OTHERWISE_HANDLE }, label: OTHERWISE_HANDLE } : e,
                ),
              }
            }
            return { edges }
          }),
        addNode: (node) => set({ nodes: [...get().nodes, node] }),
        addNote: (note) => set({ notes: [...get().notes, note] }),
        addClones: ({ nodes, edges, notes }) =>
          set({
            nodes: [...get().nodes.map((n) => ({ ...n, selected: false })), ...nodes],
            edges: [...get().edges, ...edges],
            notes: [...get().notes.map((n) => ({ ...n, selected: false })), ...notes],
          }),
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
        updateEdgeLabel: (id, label) =>
          set({ edges: get().edges.map((e) => (e.id === id ? { ...e, label } : e)) }),
        reorderDecisionEdges: (nodeId, orderedEdgeIds) =>
          set((s) => {
            const byId = new Map(s.edges.map((e) => [e.id, e]))
            let cursor = 0
            return {
              edges: s.edges.map((e) => {
                if (e.source !== nodeId || !orderedEdgeIds.includes(e.id)) return e
                const next = byId.get(orderedEdgeIds[cursor])
                cursor += 1
                return next ?? e
              }),
            }
          }),
        armPendingBranchRule: (nodeId) =>
          set((s) => ({ pendingRuleClaims: { ...s.pendingRuleClaims, [nodeId]: (s.pendingRuleClaims[nodeId] ?? 0) + 1 } })),
        disarmPendingBranchRule: (nodeId) =>
          set((s) => ({ pendingRuleClaims: { ...s.pendingRuleClaims, [nodeId]: Math.max(0, (s.pendingRuleClaims[nodeId] ?? 0) - 1) } })),
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

  // Every reactive (non-user-gesture) write into this store is wrapped
  // here, once, so the invariant lives with the store instead of being
  // remembered at each call site -- see withHistoryPaused's own header
  // comment for why a bare write would risk silently cancelling an
  // undo (docs/goals/0174). Two distinct sources need it:
  // setGuardrailVerdicts/setValidationIssues (an external re-derivation
  // landing through CompositionCanvas.tsx's own effects), and React
  // Flow's OWN internal bookkeeping changes -- a 'dimensions' change
  // from its resize/measure observer, a 'select' change from a plain
  // click -- which arrive through the exact same onNodesChange/
  // onEdgesChange/onNotesChange callbacks a real drag or delete uses.
  // Splitting each incoming change batch by NodeChange/EdgeChange
  // `type` is the only way to tell that framework bookkeeping from a
  // real edit; wrapping the whole callback would also swallow real
  // position/remove/add/replace changes riding the same batch.
  // withHistoryPaused itself is a tracked write (it calls
  // store.setState), so this whole override runs inside its own guard
  // too -- otherwise installing it would push one phantom entry before
  // the canvas has done anything.
  const raw = store.getState()
  withHistoryPaused(store, () => {
    store.setState({
      setGuardrailVerdicts: (verdicts) => withHistoryPaused(store, () => raw.setGuardrailVerdicts(verdicts)),
      setValidationIssues: (issues) => withHistoryPaused(store, () => raw.setValidationIssues(issues)),
      onNodesChange: (changes) => applySplitByIntent(store, changes, raw.onNodesChange),
      onEdgesChange: (changes) => applySplitByIntent(store, changes, raw.onEdgesChange),
      onNotesChange: (changes) => applySplitByIntent(store, changes, raw.onNotesChange),
    })
  })

  return store
}

// True for a NodeChange/EdgeChange React Flow generates on its own --
// 'dimensions' from its resize/measure observer (fires once a node's
// real DOM size is known, and again on every NodeResizer drag frame),
// 'select' from a plain click -- never from a user's own content edit
// (drag-to-move, delete, add, a config change). Both carry the exact
// same shape a real edit's change does, so only the discriminant `type`
// can tell them apart.
function isBookkeepingChange(change: { type: string }): boolean {
  return change.type === 'dimensions' || change.type === 'select'
}

// Splits one incoming change batch into bookkeeping vs. real-edit
// subsets and applies each through `apply` (the store's own, still-
// tracked onNodesChange/onEdgesChange/onNotesChange) separately -- the
// bookkeeping subset wrapped in withHistoryPaused, the real-edit subset
// left tracked exactly as before. A batch mixing both types (e.g. a
// click that both deselects the previous node and selects a new one
// alongside an unrelated remove) still ends up applied in full; only
// which subset enters undo history differs.
function applySplitByIntent<C extends { type: string }>(store: CanvasStore, changes: C[], apply: (changes: C[]) => void): void {
  const bookkeeping = changes.filter(isBookkeepingChange)
  const content = changes.filter((c) => !isBookkeepingChange(c))
  if (bookkeeping.length) withHistoryPaused(store, () => apply(bookkeeping))
  if (content.length) apply(content)
}

export type CanvasStore = ReturnType<typeof createCanvasStore>

// A reactive re-derivation (a guardrail-verdict refresh, an authoring-
// validation recheck) is never a user-authored edit and must not enter
// the undo/redo stack -- zundo tracks every set() call by default, even
// a no-op one (its own docs: a snapshot is stored "even if no value...
// has changed"), and both the state creator's `set` and the store's own
// `setState` go through the identical tracked path (verified against
// zundo's source: `store.setState` is itself reassigned to the tracked
// wrapper), so there is no way to reach an untracked write except this
// one. Left unguarded, a reactive write landing in the same tick as
// undo()/redo() re-pushes the just-undone state and silently cancels
// the undo (docs/goals/0174). pause()/resume() is zundo's own
// documented mechanism for excluding a specific write from tracking --
// every reactive (non-user-gesture) write into this store must go
// through this wrapper, never a bare setter call.
export function withHistoryPaused<T>(store: CanvasStore, fn: () => T): T {
  store.temporal.getState().pause()
  try {
    return fn()
  } finally {
    store.temporal.getState().resume()
  }
}
