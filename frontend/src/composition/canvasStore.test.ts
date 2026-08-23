import { describe, expect, it } from 'vitest'
import type { Edge as RFEdge } from '@xyflow/react'
import { createCanvasStore, type CanvasNode } from './canvasStore'

const decisionNode = (id: string): CanvasNode => ({
  id, type: 'decision', position: { x: 0, y: 0 },
  data: { nodeTypeID: 'decision-route', kind: 'decision', label: 'Branch', config: {} },
})
const targetNode = (id: string): CanvasNode => ({
  id, type: 'apply', position: { x: 0, y: 100 },
  data: { nodeTypeID: 'apply-clipboard-write-text', kind: 'apply', label: id, config: {} },
})
const ruleEdge = (id: string, source: string, target: string, condition = ''): RFEdge => ({
  id, source, target, data: { condition }, label: condition,
})
const makeNode = (id: string): CanvasNode => ({
  id, type: 'process', position: { x: 0, y: 0 },
  data: { nodeTypeID: 'process-inject-text', kind: 'process', label: id, config: {} },
})

// docs/goals/0173's own most-important-property, pinned at the store
// layer that authors the array order execute.go's nextNode reads:
// reordering must move ONLY the target Decision node's own edges,
// leaving every other node's edges (and their relative order) alone.
describe('reorderDecisionEdges', () => {
  it('reassigns only the given node\'s edges to the new order, in place', () => {
    const store = createCanvasStore(
      [decisionNode('d')],
      [
        ruleEdge('other', 'x', 'y'),
        ruleEdge('e1', 'd', 'a', 'cond1'),
        ruleEdge('e2', 'd', 'b', 'cond2'),
      ],
    )
    store.getState().reorderDecisionEdges('d', ['e2', 'e1'])
    const edges = store.getState().edges
    // 'other' keeps its own slot untouched.
    expect(edges.map((e) => e.id)).toEqual(['other', 'e2', 'e1'])
    expect(edges.find((e) => e.id === 'e2')?.source).toBe('d')
  })
})

describe('updateEdgeLabel', () => {
  it('changes only the label, never the condition', () => {
    const store = createCanvasStore([decisionNode('d')], [ruleEdge('e1', 'd', 'a', 'amount > 100')])
    store.getState().updateEdgeLabel('e1', 'High value')
    const e = store.getState().edges[0]
    expect(e.label).toBe('High value')
    expect((e.data as { condition?: string }).condition).toBe('amount > 100')
  })
})

describe('onConnect auto-fallback and pending-rule claims', () => {
  it('claims a queued "Add rule" stub instead of auto-tagging otherwise', () => {
    const store = createCanvasStore([decisionNode('d'), targetNode('a')])
    store.getState().armPendingBranchRule('d')
    store.getState().onConnect({ source: 'd', target: 'a', sourceHandle: null, targetHandle: null })
    expect(store.getState().pendingRuleClaims['d']).toBe(0)
    const newEdge = store.getState().edges[0]
    expect((newEdge.data as { condition?: string } | undefined)?.condition ?? '').toBe('')
  })

  it('auto-tags the first directly-drawn edge as otherwise when none exists yet', () => {
    const store = createCanvasStore([decisionNode('d'), targetNode('a')])
    store.getState().onConnect({ source: 'd', target: 'a', sourceHandle: null, targetHandle: null })
    const newEdge = store.getState().edges[0]
    expect((newEdge.data as { condition?: string }).condition).toBe('otherwise')
    expect(newEdge.label).toBe('otherwise')
  })

  it('leaves a second directly-drawn edge as a plain rule once otherwise already exists', () => {
    const store = createCanvasStore(
      [decisionNode('d'), targetNode('a'), targetNode('b')],
      [ruleEdge('e1', 'd', 'a', 'otherwise')],
    )
    store.getState().onConnect({ source: 'd', target: 'b', sourceHandle: null, targetHandle: null })
    const newEdge = store.getState().edges.find((e) => e.target === 'b')
    expect((newEdge?.data as { condition?: string } | undefined)?.condition ?? '').toBe('')
  })

  it('never auto-tags a non-Decision node\'s edge', () => {
    const store = createCanvasStore(
      [{ ...targetNode('p'), data: { ...targetNode('p').data, kind: 'process' } }, targetNode('a')],
      [],
    )
    store.getState().onConnect({ source: 'p', target: 'a', sourceHandle: null, targetHandle: null })
    const newEdge = store.getState().edges[0]
    expect((newEdge.data as { condition?: string } | undefined)?.condition ?? '').toBe('')
  })
})

describe('disarmPendingBranchRule', () => {
  it('floors at zero', () => {
    const store = createCanvasStore([decisionNode('d')])
    store.getState().disarmPendingBranchRule('d')
    expect(store.getState().pendingRuleClaims['d']).toBe(0)
  })
})

// docs/goals/0174: the canvas's zundo undo history could silently
// self-cancel. Two distinct sources land through this file's own
// onNodesChange/onEdgesChange/onNotesChange/setGuardrailVerdicts/
// setValidationIssues -- a reactive re-derivation (guardrail/
// validation) and React Flow's OWN internal bookkeeping NodeChange/
// EdgeChange events ('dimensions' from its resize/measure observer,
// 'select' from a plain click), both of which flow through the exact
// same callbacks a real drag/delete uses. Reproduced directly against
// real zundo: an unwrapped write landing right after undo() re-pushed
// the just-undone state and wiped the redo stack; the live e2e repro
// (a note add, then undo) traced the actual bounce to React Flow's own
// 'dimensions' change firing on the note's next render, not to
// guardrail/validation at all -- these tests pin both mechanisms.
describe('canvas undo/redo history', () => {
  it('undo actually reverts a real edit, not just parity between two entry points', () => {
    const store = createCanvasStore([makeNode('a')], [])
    store.getState().addNode(makeNode('b'))
    expect(store.getState().nodes.map((n) => n.id)).toEqual(['a', 'b'])

    store.temporal.getState().undo()
    expect(store.getState().nodes.map((n) => n.id)).toEqual(['a'])

    store.temporal.getState().redo()
    expect(store.getState().nodes.map((n) => n.id)).toEqual(['a', 'b'])
  })

  it('a guardrail re-check landing in the same tick as undo does not re-push undone state', () => {
    const store = createCanvasStore([makeNode('a')], [])
    store.getState().addNode(makeNode('b'))
    store.temporal.getState().undo()
    expect(store.getState().nodes).toHaveLength(1)

    store.getState().setGuardrailVerdicts({ a: { effect: 'ask', ruleLabel: 'r' } })

    expect(store.getState().nodes).toHaveLength(1)
    expect(store.temporal.getState().pastStates).toHaveLength(0)
    expect(store.temporal.getState().futureStates).toHaveLength(1)
    // Redo still reaches the pre-undo state -- the reactive write never
    // touched history, so the stack is exactly as if it never ran.
    store.temporal.getState().redo()
    expect(store.getState().nodes).toHaveLength(2)
  })

  it('a validation re-check landing in the same tick as undo does not re-push undone state', () => {
    const store = createCanvasStore([makeNode('a')], [])
    store.getState().addNode(makeNode('b'))
    store.temporal.getState().undo()

    store.getState().setValidationIssues({ a: [{ severity: 'error', message: 'bad config' }] })

    expect(store.getState().nodes).toHaveLength(1)
    expect(store.temporal.getState().pastStates).toHaveLength(0)
    expect(store.temporal.getState().futureStates).toHaveLength(1)
  })

  // The mechanism the live e2e repro actually traced to: React Flow
  // fires a 'dimensions' NodeChange (its own resize/measure observer)
  // whenever a node/note is newly rendered -- including right after
  // undo() re-renders the reverted canvas. Landing through the same
  // onNodesChange/onNotesChange callback a real drag uses, an unguarded
  // 'dimensions' write re-pushes the just-undone state exactly like the
  // guardrail/validation case above.
  it('a dimensions-only NodeChange lands but is never tracked as undo history', () => {
    const store = createCanvasStore([makeNode('a'), makeNode('b')], [])
    // Real content edit: b moves.
    store.getState().onNodesChange([{ id: 'b', type: 'position', position: { x: 50, y: 50 } }])
    expect(store.temporal.getState().pastStates).toHaveLength(1)

    store.temporal.getState().undo()
    expect(store.getState().nodes.find((n) => n.id === 'b')?.position).toEqual({ x: 0, y: 0 })
    expect(store.temporal.getState().pastStates).toHaveLength(0)
    expect(store.temporal.getState().futureStates).toHaveLength(1)

    // React Flow's own post-render measurement, not a user edit --
    // applyNodeChanges writes a plain 'dimensions' change onto
    // `.measured`, not `.width`/`.height` (those only change when the
    // change itself sets `setAttributes`, a real NodeResizer drag).
    store.getState().onNodesChange([{ id: 'a', type: 'dimensions', dimensions: { width: 200, height: 80 } }])

    // The dimensions change still applies to live state...
    expect(store.getState().nodes.find((n) => n.id === 'a')?.measured?.width).toBe(200)
    // ...but never entered undo history: the revert above is intact,
    // and redo still reaches the pre-undo position.
    expect(store.temporal.getState().pastStates).toHaveLength(0)
    expect(store.temporal.getState().futureStates).toHaveLength(1)
    store.temporal.getState().redo()
    expect(store.getState().nodes.find((n) => n.id === 'b')?.position).toEqual({ x: 50, y: 50 })
  })

  it('a select-only NodeChange/EdgeChange is never tracked as undo history', () => {
    const store = createCanvasStore(
      [decisionNode('d'), targetNode('a')],
      [ruleEdge('e1', 'd', 'a', 'otherwise')],
    )
    store.getState().onNodesChange([{ id: 'd', type: 'position', position: { x: 10, y: 10 } }])
    expect(store.temporal.getState().pastStates).toHaveLength(1)
    store.temporal.getState().undo()
    expect(store.temporal.getState().pastStates).toHaveLength(0)

    store.getState().onNodesChange([{ id: 'd', type: 'select', selected: true }])
    store.getState().onEdgesChange([{ id: 'e1', type: 'select', selected: true }])

    expect(store.getState().nodes.find((n) => n.id === 'd')?.selected).toBe(true)
    expect(store.getState().edges.find((e) => e.id === 'e1')?.selected).toBe(true)
    expect(store.temporal.getState().pastStates).toHaveLength(0)
    expect(store.temporal.getState().futureStates).toHaveLength(1)
  })

  it('a mixed batch tracks only its real-edit changes, applying the bookkeeping ones untracked', () => {
    const store = createCanvasStore([makeNode('a'), makeNode('b')], [])
    store.getState().onNodesChange([
      { id: 'a', type: 'dimensions', dimensions: { width: 150, height: 60 } },
      { id: 'b', type: 'position', position: { x: 20, y: 20 } },
    ])
    expect(store.getState().nodes.find((n) => n.id === 'a')?.measured?.width).toBe(150)
    expect(store.getState().nodes.find((n) => n.id === 'b')?.position).toEqual({ x: 20, y: 20 })
    // Only the position change is undo-worthy.
    expect(store.temporal.getState().pastStates).toHaveLength(1)

    store.temporal.getState().undo()
    expect(store.getState().nodes.find((n) => n.id === 'b')?.position).toEqual({ x: 0, y: 0 })
    // The dimensions change from the same batch survives the undo --
    // it was never part of the tracked snapshot in the first place.
    expect(store.getState().nodes.find((n) => n.id === 'a')?.measured?.width).toBe(150)
  })
})
