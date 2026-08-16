import { describe, expect, it } from 'vitest'
import type { Card, Link } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { resolveBoardEdges } from './atlasLinkResolution'

function card(id: string, parentID: string): Card {
  return { ID: id, ParentID: parentID } as Card
}
function link(id: string, from: string, to: string, kind = 'lk-relates'): Link {
  return { ID: id, FromCardID: from, ToCardID: to, LinkKindID: kind } as Link
}

const cards = [
  card('root', ''),
  card('areaA', 'root'),
  card('areaB', 'root'),
  card('deepA', 'areaA'),
  card('deeperA', 'deepA'),
  card('deepB', 'areaB'),
  card('leaf', 'root'),
]
const topLevel = new Set(['areaA', 'areaB', 'leaf'])

describe('resolveBoardEdges', () => {
  it('keeps a link between two top-level cards', () => {
    const edges = resolveBoardEdges([link('l1', 'areaA', 'leaf')], topLevel, cards)
    expect(edges).toEqual([{ id: 'l1', source: 'areaA', target: 'leaf', linkKindIDs: ['lk-relates'], count: 1 }])
  })

  it('lifts a deep endpoint to its top-level area', () => {
    const edges = resolveBoardEdges([link('l1', 'deeperA', 'leaf')], topLevel, cards)
    expect(edges).toEqual([{ id: 'l1', source: 'areaA', target: 'leaf', linkKindIDs: ['lk-relates'], count: 1 }])
  })

  it('draws nothing for a link fully inside one area -- internal detail belongs to the zoomed-in board', () => {
    expect(resolveBoardEdges([link('l1', 'deepA', 'deeperA')], topLevel, cards)).toEqual([])
  })

  it('aggregates cross-area links into one undirected artery with a count', () => {
    const edges = resolveBoardEdges(
      [link('l1', 'deepA', 'deepB'), link('l2', 'deepB', 'deeperA', 'lk-other'), link('l3', 'deeperA', 'deepB')],
      topLevel,
      cards,
    )
    expect(edges).toHaveLength(1)
    expect(edges[0]).toEqual({ id: 'l1', source: 'areaA', target: 'areaB', linkKindIDs: ['lk-relates', 'lk-other'], count: 3 })
  })

  it('drops a link with no top-level ancestor on this board', () => {
    const edges = resolveBoardEdges([link('l1', 'deepA', 'leaf')], new Set(['leaf']), cards)
    expect(edges).toEqual([])
  })

  it('survives a parent cycle in the data without hanging', () => {
    const cyclic = [card('a', 'b'), card('b', 'a')]
    expect(resolveBoardEdges([link('l1', 'a', 'b')], new Set<string>(), cyclic)).toEqual([])
  })
})
