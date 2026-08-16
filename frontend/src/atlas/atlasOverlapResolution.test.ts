import { describe, expect, it } from 'vitest'
import { resolveFreeOverlaps } from './atlasOverlapResolution'
import type { OverlapBox } from './atlasOverlapResolution'

function box(id: string, x: number, y: number, width: number, height: number, isFrame = false): OverlapBox {
  return { id, x, y, width, height, isFrame }
}

describe('resolveFreeOverlaps', () => {
  it('returns no moves for a clear board', () => {
    expect(resolveFreeOverlaps([box('a', 0, 0, 100, 100, true), box('b', 200, 0, 100, 100)])).toEqual([])
  })

  it('nudges the later box along the cheaper axis when a frame overlaps a leaf', () => {
    const moves = resolveFreeOverlaps([
      box('frame', 0, 0, 300, 200, true),
      // 40px into the frame horizontally, nearly fully overlapped
      // vertically -- x is the cheaper push.
      box('leaf', 260, 10, 100, 100),
    ])
    expect(moves).toEqual([{ id: 'leaf', x: 260 + 40 + 12, y: 10 }])
  })

  it('leaves a leaf-on-leaf overlap exactly where the user put it', () => {
    expect(resolveFreeOverlaps([box('a', 0, 0, 100, 100), box('b', 50, 50, 100, 100)])).toEqual([])
  })

  it('preserves relative order: the box further along the axis is the one pushed', () => {
    const moves = resolveFreeOverlaps([
      box('right', 90, 0, 100, 300, true),
      box('left', 0, 0, 100, 300, true),
    ])
    expect(moves).toHaveLength(1)
    expect(moves[0].id).toBe('right')
    expect(moves[0].x).toBeGreaterThan(90)
  })

  it('is deterministic and idempotent: resolving a resolved board moves nothing', () => {
    const input = [
      box('f1', 0, 0, 400, 250, true),
      box('f2', 100, 100, 400, 250, true),
      box('l1', 200, 200, 190, 128),
    ]
    const first = resolveFreeOverlaps(input)
    const second = resolveFreeOverlaps(input)
    expect(first).toEqual(second)

    const applied = input.map((b) => {
      const m = first.find((mv) => mv.id === b.id)
      return m ? { ...b, x: m.x, y: m.y } : b
    })
    expect(resolveFreeOverlaps(applied)).toEqual([])
  })

  it('settles a chain of frame overlaps without oscillating', () => {
    const input = Array.from({ length: 5 }, (_, i) => box(`f${i}`, i * 50, 0, 200, 150, true))
    const moves = resolveFreeOverlaps(input)
    const applied = input.map((b) => {
      const m = moves.find((mv) => mv.id === b.id)
      return m ? { ...b, x: m.x, y: m.y } : b
    })
    expect(resolveFreeOverlaps(applied)).toEqual([])
  })
})
