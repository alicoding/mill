import { describe, expect, it } from 'vitest'
import type { CanvasNode } from './canvasStore'
import { isValidCanvasConnection } from './canvasConnectionRules'

function node(id: string, kind: string): CanvasNode {
  return { id, type: kind, position: { x: 0, y: 0 }, data: { nodeTypeID: `${kind}-x`, kind, label: kind, config: {} } }
}

describe('isValidCanvasConnection', () => {
  it('rejects an outgoing edge from a terminal node', () => {
    const nodes = [node('a', 'terminal'), node('b', 'apply')]
    expect(isValidCanvasConnection(nodes, [], { source: 'a', target: 'b', sourceHandle: null, targetHandle: null })).toBe(false)
  })

  it('rejects a second outgoing edge from a non-Decision node', () => {
    const nodes = [node('a', 'apply'), node('b', 'process'), node('c', 'process')]
    const edges = [{ id: 'e1', source: 'a', target: 'b' }]
    expect(isValidCanvasConnection(nodes, edges, { source: 'a', target: 'c', sourceHandle: null, targetHandle: null })).toBe(false)
  })

  it('allows a second outgoing edge from a Decision node', () => {
    const nodes = [node('a', 'decision'), node('b', 'process'), node('c', 'process')]
    const edges = [{ id: 'e1', source: 'a', target: 'b' }]
    expect(isValidCanvasConnection(nodes, edges, { source: 'a', target: 'c', sourceHandle: null, targetHandle: null })).toBe(true)
  })

  it('rejects an edge into a trigger node', () => {
    const nodes = [node('a', 'apply'), node('b', 'trigger')]
    expect(isValidCanvasConnection(nodes, [], { source: 'a', target: 'b', sourceHandle: null, targetHandle: null })).toBe(false)
  })

  it('allows an ordinary edge with no conflicting rule', () => {
    const nodes = [node('a', 'apply'), node('b', 'process')]
    expect(isValidCanvasConnection(nodes, [], { source: 'a', target: 'b', sourceHandle: null, targetHandle: null })).toBe(true)
  })
})
