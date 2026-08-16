import { describe, expect, it } from 'vitest'
import type { Card, Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { ancestorPathLabel, filterJumpCards } from './atlasJumpFilter'

function card(id: string, title: string, parentID: string, note = ''): Card {
  return { ID: id, KindID: 'k1', Title: title, Note: note, ParentID: parentID } as Card
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
    const cards = [card('a', 'Ada Lovelace', ''), card('b', 'Bob', '')]
    const results = filterJumpCards(cards, [], 'ada')
    expect(results.map((r) => r.card.ID)).toEqual(['a'])
  })

  it('ranks a title match above a note-only match, regardless of card order', () => {
    const cards = [
      card('note-only', 'Something else', '', 'mentions ada in passing'),
      card('title-match', 'Ada Lovelace', ''),
    ]
    const results = filterJumpCards(cards, [], 'ada')
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
})

describe('ancestorPathLabel', () => {
  it('is empty for a card directly under the single auto-entered root', () => {
    const root = card('root', 'My space', '')
    const target = card('child', 'Getting started', 'root')
    expect(ancestorPathLabel([root, target], target)).toBe('')
  })

  it('names an intermediate ancestor, omitting the auto-entered root', () => {
    const root = card('root', 'My space', '')
    const area = card('area', 'Example area', 'root')
    const target = card('leaf', 'Ada Lovelace', 'area')
    expect(ancestorPathLabel([root, area, target], target)).toBe('Example area')
  })

  it('joins multiple ancestors with the separator, still omitting the root', () => {
    const root = card('root', 'My space', '')
    const area = card('area', 'Example area', 'root')
    const sub = card('sub', 'Sub area', 'area')
    const target = card('leaf', 'Deep card', 'sub')
    expect(ancestorPathLabel([root, area, sub, target], target)).toBe('Example area ▸ Sub area')
  })

  it('names every ancestor when no single root exists (2+ root cards)', () => {
    const rootA = card('rootA', 'My space', '')
    const rootB = card('rootB', 'Second root', '')
    const target = card('leaf', 'Card', 'rootA')
    expect(ancestorPathLabel([rootA, rootB, target], target)).toBe('My space')
  })
})
