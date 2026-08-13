import { describe, expect, it } from 'vitest'
import { findFreeDropPosition } from './canvasLayout'
import type { CanvasNode } from './canvasStore'
import { CANVAS_NODE_WIDTH, CANVAS_NODE_HEIGHT } from './canvasConstants'

// Regression: a node dropped on/near an existing one used to
// land stacked on top of it (docs/SPEC.md §3), producing an unreadable
// mess and a broken React Flow selection outline
// (.claude/rules/testing.md).
function node(id: string, x: number, y: number): CanvasNode {
  return { id, type: 'trigger', position: { x, y }, data: { nodeTypeID: 'trigger-manual', kind: 'trigger', label: 'Trigger: manual', config: {} } }
}

describe('findFreeDropPosition', () => {
  it('returns the desired position unchanged when nothing overlaps', () => {
    const existing = [node('a', 500, 500)]
    expect(findFreeDropPosition({ x: 0, y: 0 }, existing)).toEqual({ x: 0, y: 0 })
  })

  it('returns the desired position unchanged when there are no existing nodes', () => {
    expect(findFreeDropPosition({ x: 80, y: 80 }, [])).toEqual({ x: 80, y: 80 })
  })

  it('nudges away from a single overlapping node', () => {
    const desired = { x: 100, y: 100 }
    const existing = [node('a', 100, 100)]
    const result = findFreeDropPosition(desired, existing)
    expect(result).not.toEqual(desired)
    const dx = Math.abs(result.x - existing[0].position.x)
    const dy = Math.abs(result.y - existing[0].position.y)
    expect(dx >= CANVAS_NODE_WIDTH + 16 || dy >= CANVAS_NODE_HEIGHT + 16).toBe(true)
  })

  it('clears every existing node, not just the first one checked', () => {
    const desired = { x: 100, y: 100 }
    const existing = [node('a', 100, 100), node('b', 132, 100), node('c', 68, 100)]
    const result = findFreeDropPosition(desired, existing)
    for (const n of existing) {
      const dx = Math.abs(result.x - n.position.x)
      const dy = Math.abs(result.y - n.position.y)
      expect(dx >= CANVAS_NODE_WIDTH + 16 || dy >= CANVAS_NODE_HEIGHT + 16).toBe(true)
    }
  })

  it('treats near-miss positions within the margin as still overlapping', () => {
    // Same shape as the original bug: dropped a handful of pixels off
    // from an existing node's exact position, not exactly on top of it.
    const desired = { x: 105, y: 95 }
    const existing = [node('a', 100, 100)]
    const result = findFreeDropPosition(desired, existing)
    expect(result).not.toEqual(desired)
  })
})
