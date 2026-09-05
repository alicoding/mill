import { describe, expect, it, vi } from 'vitest'
import {
  computeGuides,
  createGuideChannel,
  GUIDE_THRESHOLD_PX,
  guideThreshold,
  sameGuides,
  type Box,
} from './alignmentGuides'

const peer: Box = { id: 'peer', x: 100, y: 100, w: 200, h: 100 }
// peer edges: x 100 / centerX 200 / x-end 300; y 100 / centerY 150 / y-end 200.

function dragged(x: number, y: number, w = 200, h = 100): Box {
  return { id: 'dragged', x, y, w, h }
}

// Far enough on the OTHER axis that only the axis under test can match.
const FAR = 10_000

describe('computeGuides — the six candidates', () => {
  // A 60x40 dragged box against the 200x100 peer: its own anchors are
  // spaced differently from the peer's, so exactly one of the nine
  // pairs can win each case.
  const SMALL_W = 60
  const SMALL_H = 40

  it.each([
    ['its left edge to the peer left edge', 104, 100],
    ['its left edge to the peer centre', 204, 200],
    ['its left edge to the peer right edge', 304, 300],
    ['its centre to the peer left edge', 74, 100],
    ['its centre to the peer centre', 174, 200],
    ['its centre to the peer right edge', 274, 300],
    ['its right edge to the peer left edge', 44, 100],
    ['its right edge to the peer centre', 144, 200],
    ['its right edge to the peer right edge', 244, 300],
  ])('aligns %s', (_label, x, at) => {
    const { guides, snap } = computeGuides(dragged(x, FAR, SMALL_W, SMALL_H), [peer], 8)
    const vertical = guides.find((g) => g.axis === 'x')
    expect(vertical?.at).toBe(at)
    expect(snap.dy).toBe(0)
    const snapped = x + snap.dx
    expect([snapped, snapped + SMALL_W / 2, snapped + SMALL_W]).toContain(at)
  })

  it.each([
    ['its top edge to the peer top edge', 104, 100],
    ['its top edge to the peer centre', 154, 150],
    ['its top edge to the peer bottom edge', 204, 200],
    ['its centre to the peer top edge', 84, 100],
    ['its centre to the peer centre', 134, 150],
    ['its centre to the peer bottom edge', 184, 200],
    ['its bottom edge to the peer top edge', 64, 100],
    ['its bottom edge to the peer centre', 114, 150],
    ['its bottom edge to the peer bottom edge', 164, 200],
  ])('aligns %s', (_label, y, at) => {
    const { guides, snap } = computeGuides(dragged(FAR, y, SMALL_W, SMALL_H), [peer], 8)
    const horizontal = guides.find((g) => g.axis === 'y')
    expect(horizontal?.at).toBe(at)
    expect(snap.dx).toBe(0)
    const snapped = y + snap.dy
    expect([snapped, snapped + SMALL_H / 2, snapped + SMALL_H]).toContain(at)
  })

  it('reports both axes at once when the drag aligns on each', () => {
    const { guides, snap } = computeGuides(dragged(103, 96), [peer], 8)
    expect(guides.map((g) => g.axis)).toEqual(['x', 'y'])
    expect(snap).toEqual({ dx: -3, dy: 4 })
  })
})

describe('computeGuides — the threshold', () => {
  it('matches at exactly the threshold', () => {
    const { guides, snap } = computeGuides(dragged(108, FAR), [peer], 8)
    expect(guides).toHaveLength(1)
    expect(snap.dx).toBe(-8)
  })

  it('does not match one unit past it', () => {
    const { guides, snap } = computeGuides(dragged(109, FAR), [peer], 8)
    expect(guides).toEqual([])
    expect(snap).toEqual({ dx: 0, dy: 0 })
  })

  it('finds nothing with no peers at all', () => {
    expect(computeGuides(dragged(100, 100), [], 8)).toEqual({ guides: [], snap: { dx: 0, dy: 0 } })
  })

  it('never aligns a box against itself', () => {
    const self: Box = { id: 'dragged', x: 100, y: 100, w: 200, h: 100 }
    expect(computeGuides(dragged(100, 100), [self], 8).guides).toEqual([])
  })
})

describe('computeGuides — tie-breaking', () => {
  it('prefers the smallest correction', () => {
    const near: Box = { id: 'near', x: 104, y: FAR, w: 200, h: 100 }
    const { snap } = computeGuides(dragged(100, FAR), [peer, near], 8)
    expect(snap.dx).toBe(0)
  })

  it('prefers an edge match over a centre match at equal distance', () => {
    // A peer whose LEFT edge and whose CENTRE both sit 4 units from
    // the dragged box's own left edge, in opposite directions.
    const left: Box = { id: 'left-edge', x: 104, y: FAR, w: 200, h: 100 }
    const centre: Box = { id: 'centre', x: -4, y: FAR, w: 200, h: 100 }
    const { guides } = computeGuides(dragged(100, FAR), [centre, left], 8)
    expect(guides[0]?.at).toBe(104)
  })

  it('prefers the nearer peer when the correction and the anchor kinds match', () => {
    const near: Box = { id: 'near', x: 104, y: 100, w: 200, h: 100 }
    const far: Box = { id: 'far', x: 104, y: 5_000, w: 200, h: 100 }
    const { guides } = computeGuides(dragged(100, 120), [far, near], 8)
    expect(guides[0]?.to).toBe(220) // near's own bottom, not far's
  })
})

describe('computeGuides — the drawn line', () => {
  it('spans both boxes, measured from the SNAPPED dragged box', () => {
    const { guides } = computeGuides(dragged(104, 400), [peer], 8)
    expect(guides).toEqual([{ axis: 'x', at: 100, from: 100, to: 500 }])
  })

  it('spans a horizontal guide across both boxes on the x axis', () => {
    const { guides } = computeGuides(dragged(400, 104), [peer], 8)
    expect(guides).toEqual([{ axis: 'y', at: 100, from: 100, to: 600 }])
  })
})

describe('computeGuides — peers inside a frame', () => {
  // A frame's children are handed in already lifted to board
  // coordinates, exactly like every other box, so nothing about the
  // comparison changes for them.
  it('aligns against a nested sibling given in board coordinates', () => {
    const frame: Box = { id: 'frame', x: 0, y: 0, w: 600, h: 400 }
    const sibling: Box = { id: 'child', x: 320, y: 40, w: 120, h: 80 }
    const { guides, snap } = computeGuides({ id: 'me', x: 324, y: 200, w: 120, h: 80 }, [frame, sibling], 8)
    expect(snap.dx).toBe(-4)
    expect(guides[0]?.at).toBe(320)
  })
})

describe('guideThreshold', () => {
  it('is the screen distance divided by the zoom', () => {
    expect(guideThreshold(1)).toBe(GUIDE_THRESHOLD_PX)
    expect(guideThreshold(2)).toBe(4)
    expect(guideThreshold(0.5)).toBe(16)
  })

  it('falls back to the unscaled distance for a nonsense zoom', () => {
    expect(guideThreshold(0)).toBe(GUIDE_THRESHOLD_PX)
  })

  it('keeps the felt threshold constant across zoom levels', () => {
    // Four SCREEN pixels away is inside the threshold at either zoom.
    for (const zoom of [0.5, 2]) {
      const offset = 4 / zoom
      const { guides } = computeGuides(dragged(100 + offset, FAR), [peer], guideThreshold(zoom))
      expect(guides).toHaveLength(1)
    }
    // Nine SCREEN pixels away is outside it at either zoom.
    for (const zoom of [0.5, 2]) {
      const offset = 9 / zoom
      const { guides } = computeGuides(dragged(100 + offset, FAR), [peer], guideThreshold(zoom))
      expect(guides).toEqual([])
    }
  })
})

describe('the guide channel', () => {
  it('keeps the snapshot reference stable while the guides are unchanged', () => {
    const channel = createGuideChannel()
    const listener = vi.fn()
    channel.subscribe(listener)
    const first = [{ axis: 'x' as const, at: 10, from: 0, to: 50 }]
    channel.publish(first)
    const snapshot = channel.snapshot()
    channel.publish([{ axis: 'x' as const, at: 10, from: 0, to: 50 }])
    expect(channel.snapshot()).toBe(snapshot)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('notifies on a real change and on clearing', () => {
    const channel = createGuideChannel()
    const listener = vi.fn()
    const unsubscribe = channel.subscribe(listener)
    channel.publish([{ axis: 'y', at: 4, from: 0, to: 10 }])
    channel.publish([{ axis: 'y', at: 5, from: 0, to: 10 }])
    channel.publish([])
    expect(listener).toHaveBeenCalledTimes(3)
    expect(channel.snapshot()).toEqual([])
    unsubscribe()
    channel.publish([{ axis: 'x', at: 1, from: 0, to: 2 }])
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('starts empty and stays quiet when cleared twice', () => {
    const channel = createGuideChannel()
    const listener = vi.fn()
    channel.subscribe(listener)
    expect(channel.snapshot()).toEqual([])
    channel.publish([])
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('sameGuides', () => {
  it('compares axis, position and extent', () => {
    const a = [{ axis: 'x' as const, at: 1, from: 2, to: 3 }]
    expect(sameGuides(a, [{ axis: 'x', at: 1, from: 2, to: 3 }])).toBe(true)
    expect(sameGuides(a, [{ axis: 'x', at: 1, from: 2, to: 4 }])).toBe(false)
    expect(sameGuides(a, [{ axis: 'y', at: 1, from: 2, to: 3 }])).toBe(false)
    expect(sameGuides(a, [])).toBe(false)
  })
})
