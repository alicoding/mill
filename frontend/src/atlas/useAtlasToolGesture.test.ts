import { describe, expect, it, vi } from 'vitest'
import { MIN_DRAG_PX, gestureDisarmFns, isPrimaryButton, meetsDragThreshold } from './useAtlasToolGesture'

describe('isPrimaryButton (goal 0215 S2)', () => {
  it('is true only for the primary (left) button', () => {
    expect(isPrimaryButton(0)).toBe(true)
    expect(isPrimaryButton(1)).toBe(false)
    expect(isPrimaryButton(2)).toBe(false)
  })
})

describe('meetsDragThreshold (goal 0215 S2)', () => {
  it('rejects fewer than two points regardless of distance', () => {
    expect(meetsDragThreshold([])).toBe(false)
    expect(meetsDragThreshold([{ x: 0, y: 0 }])).toBe(false)
  })

  it('rejects a start/end pair under MIN_DRAG_PX on both axes', () => {
    expect(meetsDragThreshold([{ x: 0, y: 0 }, { x: 2, y: 2 }])).toBe(false)
    expect(meetsDragThreshold([{ x: 0, y: 0 }, { x: MIN_DRAG_PX - 1, y: MIN_DRAG_PX - 1 }])).toBe(false)
  })

  it('accepts once EITHER axis reaches MIN_DRAG_PX', () => {
    expect(meetsDragThreshold([{ x: 0, y: 0 }, { x: MIN_DRAG_PX, y: 0 }])).toBe(true)
    expect(meetsDragThreshold([{ x: 0, y: 0 }, { x: 0, y: MIN_DRAG_PX }])).toBe(true)
  })

  it('reads only the FIRST and LAST point, ignoring a wandering middle', () => {
    // A path that wanders far away mid-drag but returns close to start
    // must still read as below-threshold -- the marquee/stroke commit
    // guard is about the drag's own start->end extent, not its total
    // travel distance.
    const points = [{ x: 0, y: 0 }, { x: 500, y: 500 }, { x: 1, y: 1 }]
    expect(meetsDragThreshold(points)).toBe(false)
  })

  it('respects a custom min override', () => {
    expect(meetsDragThreshold([{ x: 0, y: 0 }, { x: 3, y: 0 }], 2)).toBe(true)
    expect(meetsDragThreshold([{ x: 0, y: 0 }, { x: 3, y: 0 }], 10)).toBe(false)
  })
})

describe('gestureDisarmFns (goal 0215 S2 design lock item 2)', () => {
  it('hands a sticky tool no-ops -- its own onEnd cannot disarm even if it tried', () => {
    const disarm = vi.fn()
    const disarmUnlessLocked = vi.fn()
    const fns = gestureDisarmFns(true, disarm, disarmUnlessLocked)
    fns.disarm()
    fns.disarmUnlessLocked()
    expect(disarm).not.toHaveBeenCalled()
    expect(disarmUnlessLocked).not.toHaveBeenCalled()
  })

  it('hands a one-shot tool the real functions', () => {
    const disarm = vi.fn()
    const disarmUnlessLocked = vi.fn()
    const fns = gestureDisarmFns(false, disarm, disarmUnlessLocked)
    fns.disarm()
    fns.disarmUnlessLocked()
    expect(disarm).toHaveBeenCalledTimes(1)
    expect(disarmUnlessLocked).toHaveBeenCalledTimes(1)
  })
})
