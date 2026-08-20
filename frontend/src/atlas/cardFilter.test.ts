import { describe, expect, it } from 'vitest'
import type { Card, Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { type BoardFilter, EMPTY_BOARD_FILTER, facetFieldsFrom, filterIsActive, matchesBoardFilter } from './cardFilter'

const card = (over: Partial<Card>): Card => ({ Title: '', Note: '', KindID: 'k1', ID: 'c1', ...over } as Card)
const filter = (over: Partial<BoardFilter>): BoardFilter => ({ query: '', kindIDs: new Set(), fieldValues: new Map(), ...over })

describe('matchesBoardFilter', () => {
  it('an inactive filter matches everything', () => {
    expect(filterIsActive(EMPTY_BOARD_FILTER)).toBe(false)
    expect(matchesBoardFilter(card({ Title: 'anything' }), EMPTY_BOARD_FILTER)).toBe(true)
  })
  it('text matches title or note, case-insensitive substring', () => {
    const f = filter({ query: 'VENDOR' })
    expect(matchesBoardFilter(card({ Title: 'Vendor call' }), f)).toBe(true)
    expect(matchesBoardFilter(card({ Title: 'x', Note: 'our vendors' }), f)).toBe(true)
    expect(matchesBoardFilter(card({ Title: 'x', Note: 'y' }), f)).toBe(false)
  })
  it('kind facet is member-of-set, ANDed with text', () => {
    const f = filter({ query: 'call', kindIDs: new Set(['k2']) })
    expect(matchesBoardFilter(card({ Title: 'Vendor call', KindID: 'k2' }), f)).toBe(true)
    expect(matchesBoardFilter(card({ Title: 'Vendor call', KindID: 'k1' }), f)).toBe(false)
    expect(matchesBoardFilter(card({ Title: 'other', KindID: 'k2' }), f)).toBe(false)
  })
  it('field values OR within a field, AND across fields', () => {
    const f = filter({ fieldValues: new Map([['status', new Set(['Open', 'Done'])]]) })
    expect(filterIsActive(f)).toBe(true)
    expect(matchesBoardFilter(card({ Fields: { status: 'Open' } }), f)).toBe(true)
    expect(matchesBoardFilter(card({ Fields: { status: 'Done' } }), f)).toBe(true)
    expect(matchesBoardFilter(card({ Fields: { status: 'Blocked' } }), f)).toBe(false)

    const both = filter({ fieldValues: new Map([['status', new Set(['Open'])], ['tier', new Set(['Gold'])]]) })
    expect(matchesBoardFilter(card({ Fields: { status: 'Open', tier: 'Gold' } }), both)).toBe(true)
    expect(matchesBoardFilter(card({ Fields: { status: 'Open' } }), both)).toBe(false)
  })
  it('a card without the field (or with it unset) never matches its criterion', () => {
    const f = filter({ fieldValues: new Map([['status', new Set(['Open'])]]) })
    expect(matchesBoardFilter(card({}), f)).toBe(false)
    expect(matchesBoardFilter(card({ Fields: {} }), f)).toBe(false)
  })
})

describe('facetFieldsFrom', () => {
  const kind = (id: string, fields: unknown[]): Kind => ({ ID: id, Label: id, Fields: fields } as Kind)
  it('offers only options-typed fields with values', () => {
    const out = facetFieldsFrom([
      kind('k1', [
        { Key: 'status', Label: 'Status', Type: 'options', Options: ['Open', 'Done'] },
        { Key: 'email', Label: 'Email', Type: 'text' },
        { Key: 'empty', Label: 'Empty', Type: 'options', Options: [] },
      ]),
    ])
    expect(out).toEqual([{ key: 'status', label: 'Status', values: ['Open', 'Done'] }])
  })
  it('merges same-key fields across kinds into one facet with unioned values', () => {
    const out = facetFieldsFrom([
      kind('k1', [{ Key: 'status', Label: 'Status', Type: 'options', Options: ['Open', 'Done'] }]),
      kind('k2', [{ Key: 'status', Label: 'State', Type: 'options', Options: ['New', 'Done'] }]),
    ])
    expect(out).toEqual([{ key: 'status', label: 'Status', values: ['Open', 'Done', 'New'] }])
  })
})
