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
  card('frame', 'root'),
  card('deep', 'frame'),
  card('deeper', 'deep'),
  card('leaf', 'root'),
]

describe('resolveBoardEdges', () => {
  it('keeps a link whose endpoints are both rendered', () => {
    const edges = resolveBoardEdges([link('l1', 'frame', 'leaf')], new Set(['frame', 'leaf']), cards)
    expect(edges).toEqual([{ id: 'l1', source: 'frame', target: 'leaf', linkKindID: 'lk-relates' }])
  })

  it('reattaches a hidden endpoint to its deepest visible ancestor', () => {
    const edges = resolveBoardEdges([link('l1', 'deeper', 'leaf')], new Set(['frame', 'leaf']), cards)
    expect(edges).toEqual([{ id: 'l1', source: 'frame', target: 'leaf', linkKindID: 'lk-relates' }])
  })

  it('drops a link fully contained in one place (both resolve to the same node)', () => {
    const edges = resolveBoardEdges([link('l1', 'deep', 'deeper')], new Set(['frame', 'leaf']), cards)
    expect(edges).toEqual([])
  })

  it('drops a link with no visible ancestor', () => {
    const edges = resolveBoardEdges([link('l1', 'deep', 'leaf')], new Set(['leaf']), cards)
    expect(edges).toEqual([])
  })

  it('dedupes links collapsing onto the same resolved pair and kind, first ID wins', () => {
    const edges = resolveBoardEdges(
      [link('l1', 'deep', 'leaf'), link('l2', 'deeper', 'leaf'), link('l3', 'deep', 'leaf', 'lk-other')],
      new Set(['frame', 'leaf']),
      cards,
    )
    expect(edges.map((e) => e.id)).toEqual(['l1', 'l3'])
  })

  it('survives a parent cycle in the data without hanging', () => {
    const cyclic = [card('a', 'b'), card('b', 'a')]
    const edges = resolveBoardEdges([link('l1', 'a', 'b')], new Set<string>(), cyclic)
    expect(edges).toEqual([])
  })
})
