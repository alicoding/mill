import { describe, expect, it } from 'vitest'
import type { Card } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { EMPTY_BOARD_FILTER, filterIsActive, matchesBoardFilter } from './cardFilter'

const card = (over: Partial<Card>): Card => ({ Title: '', Note: '', KindID: 'k1', ID: 'c1', ...over } as Card)

describe('matchesBoardFilter', () => {
  it('an inactive filter matches everything', () => {
    expect(filterIsActive(EMPTY_BOARD_FILTER)).toBe(false)
    expect(matchesBoardFilter(card({ Title: 'anything' }), EMPTY_BOARD_FILTER)).toBe(true)
  })
  it('text matches title or note, case-insensitive substring', () => {
    const f = { query: 'VENDOR', kindIDs: new Set<string>() }
    expect(matchesBoardFilter(card({ Title: 'Vendor call' }), f)).toBe(true)
    expect(matchesBoardFilter(card({ Title: 'x', Note: 'our vendors' }), f)).toBe(true)
    expect(matchesBoardFilter(card({ Title: 'x', Note: 'y' }), f)).toBe(false)
  })
  it('kind facet is member-of-set, ANDed with text', () => {
    const f = { query: 'call', kindIDs: new Set(['k2']) }
    expect(matchesBoardFilter(card({ Title: 'Vendor call', KindID: 'k2' }), f)).toBe(true)
    expect(matchesBoardFilter(card({ Title: 'Vendor call', KindID: 'k1' }), f)).toBe(false)
    expect(matchesBoardFilter(card({ Title: 'other', KindID: 'k2' }), f)).toBe(false)
  })
})
