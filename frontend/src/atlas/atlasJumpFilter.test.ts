import { describe, expect, it } from 'vitest'
import type { BoardObject, Card, Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AREA_FACET_KEY, ancestorPathLabel, filterJumpCards, filterJumpObjects, objectJumpLabel } from './atlasJumpFilter'

function card(id: string, title: string, parentID: string, note = '', kindID = 'k1'): Card {
  return { ID: id, KindID: kindID, Title: title, Note: note, ParentID: parentID } as Card
}

function kind(id: string): Kind {
  return { ID: id, Label: id } as Kind
}

describe('filterJumpCards', () => {
  it('returns no results for an empty (or whitespace-only) query', () => {
    const cards = [card('a', 'Alpha', '')]
    expect(filterJumpCards(cards, [kind('k1')], '')).toEqual([])
    expect(filterJumpCards(cards, [kind('k1')], '   ')).toEqual([])
  })

  it('matches case-insensitively against the title', () => {
    const cards = [card('a', 'Jordan Reyes', ''), card('b', 'Bob', '')]
    const results = filterJumpCards(cards, [], 'jordan')
    expect(results.map((r) => r.card.ID)).toEqual(['a'])
  })

  it('ranks a title match above a note-only match, regardless of card order', () => {
    const cards = [
      card('note-only', 'Something else', '', 'mentions jordan in passing'),
      card('title-match', 'Jordan Reyes', ''),
    ]
    const results = filterJumpCards(cards, [], 'jordan')
    expect(results.map((r) => r.card.ID)).toEqual(['title-match', 'note-only'])
  })

  it('orders same-rank results by title ascending', () => {
    const cards = [card('b', 'Bravo project', ''), card('a', 'Alpha project', '')]
    const results = filterJumpCards(cards, [], 'project')
    expect(results.map((r) => r.card.ID)).toEqual(['a', 'b'])
  })

  it('caps results at 8 even when more cards match', () => {
    const cards = Array.from({ length: 12 }, (_, i) => card(`c${i}`, `Match ${i}`, ''))
    expect(filterJumpCards(cards, [], 'match')).toHaveLength(8)
  })

  it('returns an empty list when nothing matches', () => {
    const cards = [card('a', 'Alpha', '')]
    expect(filterJumpCards(cards, [], 'zzz')).toEqual([])
  })

  it('carries the matched card\'s kind through to the result', () => {
    const cards = [card('a', 'Alpha', '')]
    const results = filterJumpCards(cards, [kind('k1')], 'alpha')
    expect(results[0].kind?.ID).toBe('k1')
  })

  it('scopes to a single Kind, excluding cards of other kinds even when the text matches', () => {
    const cards = [
      card('a', 'Topic Alpha', '', '', 'topic'),
      card('b', 'Document Alpha', '', '', 'document'),
    ]
    const results = filterJumpCards(cards, [], 'alpha', 'topic')
    expect(results.map((r) => r.card.ID)).toEqual(['a'])
  })

  it('scoped + empty text lists every card of that Kind, title-ascending, capped at 8', () => {
    const cards = [
      ...Array.from({ length: 10 }, (_, i) => card(`t${i}`, `Topic ${i}`, '', '', 'topic')),
      card('doc', 'Document one', '', '', 'document'),
    ]
    const results = filterJumpCards(cards, [], '', 'topic')
    expect(results).toHaveLength(8)
    expect(results.every((r) => r.card.KindID === 'topic')).toBe(true)
    expect(results.map((r) => r.card.Title)).toEqual([...results.map((r) => r.card.Title)].sort())
  })

  it('scopes to areas (group cards) via AREA_FACET_KEY, excluding leaf cards', () => {
    // "Root" itself has a child (Client records), so it's a group card
    // too -- isGroupCard is purely structural (does a card have
    // children), independent of any parent/child depth.
    const root = card('root', 'Root', '')
    const area = card('area', 'Client records', 'root')
    const leaf = card('leaf', 'A leaf', 'area')
    const cards = [root, area, leaf]
    const results = filterJumpCards(cards, [], '', AREA_FACET_KEY)
    expect(results.map((r) => r.card.ID)).toEqual(['area', 'root'])
  })

  it('scoped area + text still substring-matches within the area candidates', () => {
    const root = card('root', 'Root', '')
    const area1 = card('area1', 'Client records', 'root')
    const area2 = card('area2', 'Another zone', 'root')
    const leaf = card('leaf', 'Client leaf', 'area1')
    const cards = [root, area1, area2, leaf]
    const results = filterJumpCards(cards, [], 'client', AREA_FACET_KEY)
    expect(results.map((r) => r.card.ID)).toEqual(['area1'])
  })

  it('an unscoped empty query still returns no results (unchanged from before faceting)', () => {
    const cards = [card('a', 'Alpha', '')]
    expect(filterJumpCards(cards, [], '')).toEqual([])
  })
})

describe('ancestorPathLabel', () => {
  it('is empty for a card directly under the single auto-entered root', () => {
    const root = card('root', 'The engagement', '')
    const target = card('child', 'Discovery workstream', 'root')
    expect(ancestorPathLabel([root, target], target)).toBe('')
  })

  it('names an intermediate ancestor, omitting the auto-entered root', () => {
    const root = card('root', 'The engagement', '')
    const area = card('area', 'Client records', 'root')
    const target = card('leaf', 'Jordan Reyes', 'area')
    expect(ancestorPathLabel([root, area, target], target)).toBe('Client records')
  })

  it('joins multiple ancestors with the separator, still omitting the root', () => {
    const root = card('root', 'The engagement', '')
    const area = card('area', 'Client records', 'root')
    const sub = card('sub', 'Sub area', 'area')
    const target = card('leaf', 'Deep card', 'sub')
    expect(ancestorPathLabel([root, area, sub, target], target)).toBe('Client records ▸ Sub area')
  })

  it('names every ancestor when no single root exists (2+ root cards)', () => {
    const rootA = card('rootA', 'The engagement', '')
    const rootB = card('rootB', 'Second root', '')
    const target = card('leaf', 'Card', 'rootA')
    expect(ancestorPathLabel([rootA, rootB, target], target)).toBe('The engagement')
  })
})

describe('filterJumpObjects / objectJumpLabel (goal 0265)', () => {
  function obj(id: string, kind: string, payload: Record<string, string>, parentID = 'root'): BoardObject {
    return { ID: id, Kind: kind, Payload: payload, ParentID: parentID } as unknown as BoardObject
  }

  it('labels by payload title, then mirror basename, then capitalized kind', () => {
    expect(objectJumpLabel(obj('a', 'diagram', { title: 'Network map', mirrorPath: '/x/y.drawio' }))).toBe('Network map')
    expect(objectJumpLabel(obj('b', 'image', { mirrorPath: '/mirrors/screenshot.png' }))).toBe('screenshot.png')
    expect(objectJumpLabel(obj('c', 'shape', {}))).toBe('Shape')
  })

  it('matches case-insensitively on the label and carries the parent breadcrumb', () => {
    const root = card('root', 'The engagement', '')
    const area = card('area', 'Client records', 'root')
    const results = filterJumpObjects([obj('d1', 'diagram', { title: 'Network map' }, 'area')], [root, area], 'network')
    expect(results).toHaveLength(1)
    expect(results[0].label).toBe('Network map')
    expect(results[0].path).toBe('Client records')
  })

  it('returns nothing for an empty or facet-scoped query', () => {
    const objects = [obj('d1', 'diagram', { title: 'Network map' })]
    expect(filterJumpObjects(objects, [], '')).toEqual([])
    expect(filterJumpObjects(objects, [], 'network', 'k1')).toEqual([])
  })
})
