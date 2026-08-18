import { describe, expect, it } from 'vitest'
import { nearestInDirection, readingOrder } from './atlasKeyboardNavGeometry'
import type { NavBox } from './atlasKeyboardNavGeometry'

describe('readingOrder', () => {
  it('sorts a single row left-to-right regardless of input order', () => {
    const boxes: NavBox[] = [
      { id: 'c', x: 400, y: 0, width: 100, height: 100 },
      { id: 'a', x: 0, y: 0, width: 100, height: 100 },
      { id: 'b', x: 200, y: 0, width: 100, height: 100 },
    ]
    expect(readingOrder(boxes).map((b) => b.id)).toEqual(['a', 'b', 'c'])
  })

  it('groups boxes into rows by vertical overlap, then sorts rows top-to-bottom', () => {
    const boxes: NavBox[] = [
      { id: 'bottom-right', x: 300, y: 400, width: 100, height: 100 },
      { id: 'top-left', x: 0, y: 0, width: 100, height: 100 },
      { id: 'top-right', x: 300, y: 10, width: 100, height: 100 },
      { id: 'bottom-left', x: 0, y: 410, width: 100, height: 100 },
    ]
    expect(readingOrder(boxes).map((b) => b.id)).toEqual(['top-left', 'top-right', 'bottom-left', 'bottom-right'])
  })
})

describe('nearestInDirection', () => {
  const current: NavBox = { id: 'origin', x: 0, y: 0, width: 100, height: 100 }

  it('picks the nearest candidate whose center lies in the requested direction', () => {
    const far: NavBox = { id: 'far-right', x: 600, y: 0, width: 100, height: 100 }
    const near: NavBox = { id: 'near-right', x: 300, y: 0, width: 100, height: 100 }
    const above: NavBox = { id: 'above', x: 0, y: -600, width: 100, height: 100 }
    expect(nearestInDirection(current, [far, near, above], 'right')?.id).toBe('near-right')
  })

  it('excludes a candidate outside the direction cone even if it is the closest overall', () => {
    // Directly below current, not to the right at all.
    const below: NavBox = { id: 'below', x: 0, y: 300, width: 100, height: 100 }
    expect(nearestInDirection(current, [below], 'right')).toBeNull()
  })

  it('returns null when no candidate qualifies', () => {
    expect(nearestInDirection(current, [], 'up')).toBeNull()
  })

  it('never returns the current box itself even if ids collide with a same-position candidate', () => {
    const self: NavBox = { id: 'origin', x: 0, y: 0, width: 100, height: 100 }
    expect(nearestInDirection(current, [self], 'right')).toBeNull()
  })
})
