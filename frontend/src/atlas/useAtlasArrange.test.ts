import { describe, expect, it } from 'vitest'
import { computeFreeMoves, objectArrangeTiles } from './useAtlasArrange'
import type { BoardObject, Card } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { OBJECT_FALLBACK_EXTENT } from './atlasBoardLayout'

const mk = (id: string, pos?: { x: number; y: number }): Card =>
  ({
    ID: id, KindID: 'k', Title: id, Note: '', Fields: {}, ParentID: 'p',
    Position: pos ? { X: pos.x, Y: pos.y } : null,
  } as unknown as Card)

describe('computeFreeMoves', () => {
  // Regression: resolveFreeOverlaps returns overlap NUDGES only
  // (leaf-on-leaf untouched by design), so returning it alone dropped
  // every packer seat -- two position-less seeded leaves rendered
  // exactly stacked at the zero value, and the buried card's click
  // never became actionable.
  it('seats every position-less card at a distinct position', () => {
    const a = mk('a')
    const b = mk('b')
    const moves = computeFreeMoves([a, b], [a, b], new Map(), 0)
    expect(moves.map((m) => m.id).sort()).toEqual(['a', 'b'])
    const byID = new Map(moves.map((m) => [m.id, m]))
    const seatA = byID.get('a')!
    const seatB = byID.get('b')!
    expect(seatA.x !== seatB.x || seatA.y !== seatB.y).toBe(true)
  })

  // Regression: a stored (0,0) is a REAL position (the arrange
  // button's own first packed seat persists there), never
  // "position-less" -- conflating nil with the zero value re-exiled
  // every arranged origin card below the whole board on the next
  // refresh.
  it('treats a stored (0,0) as positioned, not as a card to re-seat', () => {
    const origin = mk('origin', { x: 0, y: 0 })
    const other = mk('other', { x: 600, y: 0 })
    expect(computeFreeMoves([origin, other], [origin, other], new Map(), 0)).toEqual([])
  })

  it('leaves already-positioned, non-overlapping cards out of the moves', () => {
    const a = mk('a', { x: 40, y: 40 })
    const b = mk('b', { x: 600, y: 40 })
    expect(computeFreeMoves([a, b], [a, b], new Map(), 0)).toEqual([])
  })

  it('seats position-less cards below the positioned extent', () => {
    const fixed = mk('fixed', { x: 40, y: 40 })
    const loose = mk('loose')
    const moves = computeFreeMoves([fixed, loose], [fixed, loose], new Map(), 0)
    expect(moves.map((m) => m.id)).toEqual(['loose'])
    expect(moves[0].y).toBeGreaterThan(40)
  })
})

const mkObj = (id: string, pos: { x: number; y: number }, size?: { w: number; h: number }): BoardObject =>
  ({
    ID: id, Kind: 'image', Payload: {}, ParentID: 'p',
    Position: { X: pos.x, Y: pos.y },
    Size: size ? { W: size.w, H: size.h } : null,
    CreatedAt: '2024-01-01',
  } as unknown as BoardObject)

describe('computeFreeMoves with board objects (goal 0265)', () => {
  // Regression: the seating extent only counted cards, so on an
  // object-heavy board every fresh position-less card seated at the
  // zero row, straight underneath the objects.
  it('seats a position-less card below the objects’ extent, not under them', () => {
    const loose = mk('loose')
    const obj = mkObj('obj', { x: 0, y: 0 }, { w: 400, h: 300 })
    const moves = computeFreeMoves([loose], [loose], new Map(), 0, [obj])
    expect(moves.map((m) => m.id)).toEqual(['loose'])
    expect(moves[0].y).toBeGreaterThanOrEqual(300)
  })

  it('an unsized object counts at the fallback extent', () => {
    const loose = mk('loose')
    const obj = mkObj('obj', { x: 0, y: 10 })
    const moves = computeFreeMoves([loose], [loose], new Map(), 0, [obj])
    expect(moves[0].y).toBeGreaterThanOrEqual(10 + OBJECT_FALLBACK_EXTENT)
  })
})

describe('objectArrangeTiles', () => {
  it('prefers the measured box, then the persisted Size, then the fallback', () => {
    const measured = mkObj('m', { x: 0, y: 0 }, { w: 100, h: 100 })
    const sized = mkObj('s', { x: 0, y: 0 }, { w: 250, h: 150 })
    const bare = mkObj('b', { x: 0, y: 0 })
    const tiles = objectArrangeTiles([measured, sized, bare], [{ id: 'm', width: 320, height: 240 }])
    expect(tiles).toEqual([
      { id: 'm', width: 320, height: 240, createdAt: '2024-01-01' },
      { id: 's', width: 250, height: 150, createdAt: '2024-01-01' },
      { id: 'b', width: OBJECT_FALLBACK_EXTENT, height: OBJECT_FALLBACK_EXTENT, createdAt: '2024-01-01' },
    ])
  })

  it('ignores a zero-sized measurement (an unrendered node) in favor of the fallback chain', () => {
    const obj = mkObj('z', { x: 0, y: 0 }, { w: 200, h: 120 })
    const tiles = objectArrangeTiles([obj], [{ id: 'z', width: 0, height: 0 }])
    expect(tiles[0]).toMatchObject({ width: 200, height: 120 })
  })
})
