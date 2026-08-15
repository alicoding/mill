import { describe, expect, it } from 'vitest'
import { findFreeDropPosition } from './canvasLayout'

// Regression: a node dropped on/near an existing one used to
// land stacked on top of it (docs/SPEC.md §3), producing an unreadable
// mess and a broken React Flow selection outline
// (.claude/rules/testing.md).
const DIMS = { width: 220, height: 78 }

function positioned(x: number, y: number) {
  return { position: { x, y } }
}

describe('findFreeDropPosition', () => {
  it('returns the desired position unchanged when nothing overlaps', () => {
    const existing = [positioned(500, 500)]
    expect(findFreeDropPosition({ x: 0, y: 0 }, existing, DIMS)).toEqual({ x: 0, y: 0 })
  })

  it('returns the desired position unchanged when there are no existing nodes', () => {
    expect(findFreeDropPosition({ x: 80, y: 80 }, [], DIMS)).toEqual({ x: 80, y: 80 })
  })

  it('nudges away from a single overlapping node', () => {
    const desired = { x: 100, y: 100 }
    const existing = [positioned(100, 100)]
    const result = findFreeDropPosition(desired, existing, DIMS)
    expect(result).not.toEqual(desired)
    const dx = Math.abs(result.x - existing[0].position.x)
    const dy = Math.abs(result.y - existing[0].position.y)
    expect(dx >= DIMS.width + 16 || dy >= DIMS.height + 16).toBe(true)
  })

  it('clears every existing node, not just the first one checked', () => {
    const desired = { x: 100, y: 100 }
    const existing = [positioned(100, 100), positioned(132, 100), positioned(68, 100)]
    const result = findFreeDropPosition(desired, existing, DIMS)
    for (const n of existing) {
      const dx = Math.abs(result.x - n.position.x)
      const dy = Math.abs(result.y - n.position.y)
      expect(dx >= DIMS.width + 16 || dy >= DIMS.height + 16).toBe(true)
    }
  })

  it('treats near-miss positions within the margin as still overlapping', () => {
    // Same shape as the original bug: dropped a handful of pixels off
    // from an existing node's exact position, not exactly on top of it.
    const desired = { x: 105, y: 95 }
    const existing = [positioned(100, 100)]
    const result = findFreeDropPosition(desired, existing, DIMS)
    expect(result).not.toEqual(desired)
  })

  it('uses the caller-supplied footprint, not a fixed size', () => {
    // A smaller footprint (e.g. Atlas's card) must not treat a
    // farther-apart neighbor as overlapping just because Composition's
    // node footprint would have.
    const smallDims = { width: 40, height: 40 }
    const existing = [positioned(100, 100)]
    expect(findFreeDropPosition({ x: 160, y: 100 }, existing, smallDims)).toEqual({ x: 160, y: 100 })
  })
})
