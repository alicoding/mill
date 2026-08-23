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
