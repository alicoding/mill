import { describe, expect, it } from 'vitest'
import type { Card, Link, Perspective } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { filterCardsByPerspective, filterLinksByPerspective } from './atlasPerspectiveFilter'

function card(id: string): Card {
  return { ID: id } as Card
}
function link(id: string, from: string, to: string): Link {
  return { ID: id, FromCardID: from, ToCardID: to } as Link
}
function perspective(memberCardIDs: string[], memberLinkIDs: string[]): Perspective {
  return { MemberCardIDs: memberCardIDs, MemberLinkIDs: memberLinkIDs } as Perspective
}

const cards = [card('a'), card('b'), card('c')]
const links = [link('l1', 'a', 'b'), link('l2', 'b', 'c')]

describe('filterCardsByPerspective', () => {
  it('returns every card unfiltered when no perspective is active', () => {
    expect(filterCardsByPerspective(cards, null)).toEqual(cards)
  })

  it('keeps only member cards', () => {
    expect(filterCardsByPerspective(cards, perspective(['a', 'c'], []))).toEqual([card('a'), card('c')])
  })
})

describe('filterLinksByPerspective', () => {
  it('returns every link unfiltered when no perspective is active', () => {
    expect(filterLinksByPerspective(links, null)).toEqual(links)
  })

  it('keeps a link only when the link itself and both endpoints are members', () => {
    // l1's endpoints (a, b) are both members and l1 itself is a member -- renders.
    // l2 (b -> c) has c missing from membership -- must NOT render even though
    // l2's own id is listed, matching ADR-0041's stored-not-derived link rule.
    const p = perspective(['a', 'b'], ['l1', 'l2'])
    expect(filterLinksByPerspective(links, p)).toEqual([link('l1', 'a', 'b')])
  })

  it('drops a link whose own id is not a member even when both endpoints are', () => {
    const p = perspective(['a', 'b'], [])
    expect(filterLinksByPerspective(links, p)).toEqual([])
  })
})
