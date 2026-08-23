import { describe, expect, it } from 'vitest'
import { enclosedIDs, normalizeRect, pointHitIDs } from './atlasEnclosure'

describe('normalizeRect', () => {
  it('normalizes a drag drawn top-left to bottom-right', () => {
    expect(normalizeRect({ x: 10, y: 10 }, { x: 50, y: 40 })).toEqual({ x: 10, y: 10, width: 40, height: 30 })
  })

  it('normalizes a drag drawn bottom-right to top-left (negative delta)', () => {
    expect(normalizeRect({ x: 50, y: 40 }, { x: 10, y: 10 })).toEqual({ x: 10, y: 10, width: 40, height: 30 })
  })

  it('normalizes a drag drawn in the mixed diagonal direction', () => {
    expect(normalizeRect({ x: 10, y: 40 }, { x: 50, y: 10 })).toEqual({ x: 10, y: 10, width: 40, height: 30 })
  })
})

describe('enclosedIDs', () => {
  const rect = { x: 0, y: 0, width: 100, height: 100 }

  it('includes a box whose center is fully inside the rect', () => {
    const boxes = [{ id: 'a', x: 10, y: 10, width: 20, height: 20 }]
    expect(enclosedIDs(rect, boxes)).toEqual(['a'])
  })

  it('includes a box whose center is inside even when its edges spill outside the rect', () => {
    const boxes = [{ id: 'a', x: -10, y: -10, width: 40, height: 40 }] // center at (10,10)
    expect(enclosedIDs(rect, boxes)).toEqual(['a'])
  })

  it('excludes a box whose center falls outside the rect', () => {
    const boxes = [{ id: 'a', x: 90, y: 90, width: 40, height: 40 }] // center at (110,110)
    expect(enclosedIDs(rect, boxes)).toEqual([])
  })

  it('treats a center exactly on the rect boundary as enclosed', () => {
    const boxes = [{ id: 'a', x: 90, y: 40, width: 20, height: 20 }] // center at (100,50)
    expect(enclosedIDs(rect, boxes)).toEqual(['a'])
  })

  it('returns every enclosed id, preserving input order, out of a mixed set', () => {
    const boxes = [
      { id: 'inside-1', x: 5, y: 5, width: 10, height: 10 },
      { id: 'outside', x: 200, y: 200, width: 10, height: 10 },
      { id: 'inside-2', x: 60, y: 60, width: 10, height: 10 },
    ]
    expect(enclosedIDs(rect, boxes)).toEqual(['inside-1', 'inside-2'])
  })

  it('returns an empty array for an empty box list', () => {
    expect(enclosedIDs(rect, [])).toEqual([])
  })

  it('returns an empty array for a zero-size rect (a click, not a drag)', () => {
    const zero = { x: 50, y: 50, width: 0, height: 0 }
    const boxes = [{ id: 'a', x: 10, y: 10, width: 20, height: 20 }]
    expect(enclosedIDs(zero, boxes)).toEqual([])
  })
})

describe('pointHitIDs', () => {
  const boxes = [{ id: 'a', x: 0, y: 0, width: 20, height: 20 }]

  it('counts a point near the edge as a hit, unlike enclosedIDs\' center rule', () => {
    // A point at (2,2) is nowhere near this box's center (10,10), so
    // enclosedIDs (a marquee-select rule) would never enclose it -- the
    // eraser's own "touched, not mostly covered" rule must still hit.
    expect(pointHitIDs({ x: 2, y: 2 }, boxes)).toEqual(['a'])
  })

  it('excludes a point outside the box entirely', () => {
    expect(pointHitIDs({ x: 100, y: 100 }, boxes)).toEqual([])
  })

  it('treats a point exactly on the box boundary as a hit', () => {
    expect(pointHitIDs({ x: 20, y: 20 }, boxes)).toEqual(['a'])
  })

  it('returns every box a single point lands inside, out of a mixed set', () => {
    const overlapping = [
      { id: 'small', x: 0, y: 0, width: 20, height: 20 },
      { id: 'big', x: -10, y: -10, width: 40, height: 40 },
      { id: 'elsewhere', x: 200, y: 200, width: 10, height: 10 },
    ]
    expect(pointHitIDs({ x: 5, y: 5 }, overlapping)).toEqual(['small', 'big'])
  })

  it('returns an empty array for an empty box list', () => {
    expect(pointHitIDs({ x: 5, y: 5 }, [])).toEqual([])
  })
})
