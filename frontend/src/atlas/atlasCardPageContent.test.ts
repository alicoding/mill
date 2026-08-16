import { describe, expect, it } from 'vitest'
import type { Card, Link, LinkKind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { isPersonKind, orderContentChildren, orderContentLinks, personInitial } from './atlasCardPageContent'

function card(id: string, title: string, parentID: string, kindID = 'kind-topic'): Card {
  return { ID: id, KindID: kindID, Title: title, ParentID: parentID } as Card
}

function link(id: string, from: string, to: string, linkKindID: string): Link {
  return { ID: id, FromCardID: from, ToCardID: to, LinkKindID: linkKindID } as Link
}

describe('isPersonKind', () => {
  it('matches only the seeded Contact kind id', () => {
    expect(isPersonKind('atlas-kind-contact')).toBe(true)
    expect(isPersonKind('atlas-kind-topic')).toBe(false)
  })
})

describe('orderContentChildren', () => {
  it('lists non-group children before group children, each sorted by title', () => {
    const parent = card('p', 'Parent', '')
    const groupChild = card('g', 'Zeta group', 'p')
    const groupGrandchild = card('gg', 'Grandchild', 'g')
    const docB = card('b', 'Bravo doc', 'p')
    const docA = card('a', 'Alpha doc', 'p')
    const all = [parent, groupChild, groupGrandchild, docB, docA]

    const ordered = orderContentChildren(all, 'p').map((c) => c.ID)
    expect(ordered).toEqual(['a', 'b', 'g'])
  })
})

describe('orderContentLinks', () => {
  it('sorts by link-kind label then the other card\'s title', () => {
    const cardByID = new Map<string, Card>([
      ['x', card('x', 'X card', '')],
      ['y', card('y', 'A card', '')],
      ['z', card('z', 'B card', '')],
    ])
    const linkKindByID = new Map<string, LinkKind>([
      ['lk-b', { ID: 'lk-b', Label: 'B kind' } as LinkKind],
      ['lk-a', { ID: 'lk-a', Label: 'A kind' } as LinkKind],
    ])
    const links: Link[] = [
      link('l1', 'x', 'z', 'lk-b'),
      link('l2', 'x', 'y', 'lk-a'),
    ]
    const ordered = orderContentLinks(links, 'x', cardByID, linkKindByID).map((e) => e.link.ID)
    expect(ordered).toEqual(['l2', 'l1'])
  })

  it('includes a link regardless of which direction cardID appears in', () => {
    const cardByID = new Map<string, Card>([['other', card('other', 'Other', '')]])
    const linkKindByID = new Map<string, LinkKind>([['lk', { ID: 'lk', Label: 'relates to' } as LinkKind]])
    const links: Link[] = [link('l1', 'other', 'me', 'lk')]
    const ordered = orderContentLinks(links, 'me', cardByID, linkKindByID)
    expect(ordered).toHaveLength(1)
    expect(ordered[0].other?.ID).toBe('other')
  })
})

describe('personInitial', () => {
  it('uppercases the first character of the title', () => {
    expect(personInitial('ada lovelace')).toBe('A')
  })

  it('falls back to a placeholder for an empty title', () => {
    expect(personInitial('   ')).toBe('?')
  })
})
