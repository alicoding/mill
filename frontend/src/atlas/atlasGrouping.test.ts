import { describe, expect, it } from 'vitest'
import type { Card, Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { applyLens, buildBreadcrumbPath, childrenOf, groupByKind } from './atlasGrouping'

function card(id: string, kindID: string, parentID: string): Card {
  return { ID: id, KindID: kindID, Title: id, ParentID: parentID } as Card
}

function kind(id: string): Kind {
  return { ID: id, Label: id } as Kind
}

describe('childrenOf', () => {
  it('returns only cards whose ParentID matches', () => {
    const cards = [card('a', 'k1', 'root'), card('b', 'k1', 'other'), card('c', 'k1', 'root')]
    expect(childrenOf(cards, 'root').map((c) => c.ID)).toEqual(['a', 'c'])
  })

  it('matches an empty parentID for root-level cards', () => {
    const cards = [card('a', 'k1', ''), card('b', 'k1', 'x')]
    expect(childrenOf(cards, '').map((c) => c.ID)).toEqual(['a'])
  })
})

describe('groupByKind', () => {
  it('produces one shelf per kind that has at least one card, in kind-declared order', () => {
    const kinds = [kind('k1'), kind('k2'), kind('k3')]
    const cards = [card('a', 'k2', ''), card('b', 'k1', ''), card('c', 'k2', '')]
    const shelves = groupByKind(cards, kinds)
    expect(shelves.map((s) => s.kind.ID)).toEqual(['k1', 'k2'])
    expect(shelves.find((s) => s.kind.ID === 'k2')?.cards.map((c) => c.ID)).toEqual(['a', 'c'])
  })

  it('omits a kind with zero cards entirely -- no empty shelves', () => {
    const kinds = [kind('k1'), kind('k2')]
    const cards = [card('a', 'k1', '')]
    expect(groupByKind(cards, kinds).map((s) => s.kind.ID)).toEqual(['k1'])
  })

  it('returns no shelves for an empty card list', () => {
    expect(groupByKind([], [kind('k1')])).toEqual([])
  })
})

describe('buildBreadcrumbPath', () => {
  it('returns an empty path at the virtual root', () => {
    expect(buildBreadcrumbPath([card('a', 'k1', '')], '')).toEqual([])
  })

  it('walks ParentID from root down to the viewed card, oldest first', () => {
    const cards = [card('grandparent', 'k1', ''), card('parent', 'k1', 'grandparent'), card('child', 'k1', 'parent')]
    const path = buildBreadcrumbPath(cards, 'child')
    expect(path.map((c) => c.ID)).toEqual(['grandparent', 'parent', 'child'])
  })

  it('stops at whatever ancestor still resolves when one is missing (e.g. deleted by a concurrent edit)', () => {
    const cards = [card('parent', 'k1', 'ghost-ancestor'), card('child', 'k1', 'parent')]
    const path = buildBreadcrumbPath(cards, 'child')
    expect(path.map((c) => c.ID)).toEqual(['parent', 'child'])
  })
})

describe('applyLens', () => {
  it('returns every card unchanged when no kind is hidden', () => {
    const cards = [card('a', 'k1', ''), card('b', 'k2', '')]
    expect(applyLens(cards, [])).toBe(cards)
  })

  it('filters out every card whose kind is hidden', () => {
    const cards = [card('a', 'k1', ''), card('b', 'k2', ''), card('c', 'k1', '')]
    expect(applyLens(cards, ['k1']).map((c) => c.ID)).toEqual(['b'])
  })
})
