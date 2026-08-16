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

  it('clears an existing node\'s own larger footprint, not the new node\'s smaller one', () => {
    // Regression (goal 0072 slice A): a new leaf note (190x128) once
    // landed underneath an existing region frame (far larger than any
    // single note) because collision-avoidance measured every sibling
    // at the new node's own uniform size.
    const noteDims = { width: 190, height: 128 }
    const frameDims = { width: 428, height: 174 }
    const framePosition = { x: 80, y: 80 }
    const existing = [{ position: framePosition, dims: frameDims }]
    const desired = { x: 320, y: 80 } // inside the frame's true footprint (80..508), clear of a bare 190-wide box at 80
    const result = findFreeDropPosition(desired, existing, noteDims)
    expect(result).not.toEqual(desired)
    // The chosen box (top-left result, noteDims) must clear the
    // frame's REAL, larger footprint (top-left framePosition, frameDims)
    // on at least one axis -- the same asymmetric top-left overlap test
    // canvasLayout.ts's own overlap check applies internally.
    const xOverlaps = result.x < framePosition.x + frameDims.width + 16 && framePosition.x < result.x + noteDims.width + 16
    const yOverlaps = result.y < framePosition.y + frameDims.height + 16 && framePosition.y < result.y + noteDims.height + 16
    expect(xOverlaps && yOverlaps).toBe(false)
  })

  it('falls back to the shared dims for an existing entry with no override', () => {
    const existing = [positioned(100, 100)] // no .dims -- must use DIMS, same as every pre-existing caller
    const result = findFreeDropPosition({ x: 100, y: 100 }, existing, DIMS)
    expect(result).not.toEqual({ x: 100, y: 100 })
  })
})
