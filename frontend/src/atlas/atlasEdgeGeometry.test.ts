import { describe, expect, it } from 'vitest'
import { floatingEdgeEndpoints } from './atlasEdgeGeometry'

describe('floatingEdgeEndpoints', () => {
  it('meets facing sides for horizontally separated cards', () => {
    const { sx, sy, tx, ty } = floatingEdgeEndpoints(
      { x: 0, y: 0, width: 190, height: 128 },
      { x: 400, y: 0, width: 190, height: 128 },
    )
    expect(sx).toBe(190)
    expect(sy).toBe(64)
    expect(tx).toBe(400)
    expect(ty).toBe(64)
  })

  it('meets top/bottom faces for vertically separated cards', () => {
    const { sx, sy, tx, ty } = floatingEdgeEndpoints(
      { x: 0, y: 0, width: 190, height: 128 },
      { x: 0, y: 500, width: 190, height: 128 },
    )
    expect(sx).toBe(95)
    expect(sy).toBe(128)
    expect(tx).toBe(95)
    expect(ty).toBe(500)
  })

  it('quantizes diagonals to one SIDE midpoint, never a sliding corner point', () => {
    const source = { x: 0, y: 0, width: 100, height: 100 }
    const { sx, sy } = floatingEdgeEndpoints(source, { x: 300, y: 300, width: 100, height: 100 })
    expect(sx).toBe(100)
    expect(sy).toBe(50)
  })

  it('holds the anchor still while the partner moves within the same quadrant', () => {
    const source = { x: 0, y: 0, width: 100, height: 100 }
    const a = floatingEdgeEndpoints(source, { x: 300, y: 40, width: 100, height: 100 })
    const b = floatingEdgeEndpoints(source, { x: 320, y: 90, width: 100, height: 100 })
    expect([a.sx, a.sy]).toEqual([b.sx, b.sy])
  })

  it('degrades to the center for fully coincident cards instead of NaN', () => {
    const r = { x: 10, y: 10, width: 50, height: 50 }
    const { sx, sy, tx, ty } = floatingEdgeEndpoints(r, r)
    expect([sx, sy, tx, ty]).toEqual([35, 35, 35, 35])
  })
})
