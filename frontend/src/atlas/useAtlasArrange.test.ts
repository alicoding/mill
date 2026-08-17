import { describe, expect, it } from 'vitest'
import { computeFreeMoves } from './useAtlasArrange'
import type { Card } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'

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
