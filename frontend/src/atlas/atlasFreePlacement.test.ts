import { describe, expect, it } from 'vitest'
import { freePositionAmong } from './atlasFreePlacement'

describe('freePositionAmong', () => {
  it('takes the first free spot when the board has room', () => {
    const spot = freePositionAmong([{ x: 900, y: 900, width: 100, height: 100 }], { width: 520, height: 166 })
    expect(spot).toEqual({ X: 80, Y: 80 })
  })

  it('lands below everything when a crowded board defeats the spiral, never on an overlap', () => {
    const boxes = Array.from({ length: 6 }, (_, i) => ({ x: i * 300, y: 0, width: 280, height: 700 }))
    const size = { width: 520, height: 166 }
    const spot = freePositionAmong(boxes, size)
    expect(spot.Y).toBeGreaterThanOrEqual(700)
    const collides = boxes.some((b) => spot.X < b.x + b.width && b.x < spot.X + size.width && spot.Y < b.y + b.height && b.y < spot.Y + size.height)
    expect(collides).toBe(false)
  })
})
