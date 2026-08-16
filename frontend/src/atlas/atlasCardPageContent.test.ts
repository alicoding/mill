import { describe, expect, it } from 'vitest'
import type { Card, Link, LinkKind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { capPageEntries, eagerPreviewIDs, isPersonKind, orderContentChildren, orderContentLinks, personInitial } from './atlasCardPageContent'

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

describe('capPageEntries', () => {
  it('passes every entry through untouched when under the limit', () => {
    const entries = [1, 2, 3]
    expect(capPageEntries(entries, 12)).toEqual({ visible: [1, 2, 3], hiddenCount: 0 })
  })

  it('passes every entry through untouched at exactly the limit -- no expander', () => {
    const entries = Array.from({ length: 12 }, (_, i) => i)
    expect(capPageEntries(entries, 12)).toEqual({ visible: entries, hiddenCount: 0 })
  })

  it('caps to limit-1 visible plus an honest hiddenCount when over the limit', () => {
    const entries = Array.from({ length: 16 }, (_, i) => i)
    const result = capPageEntries(entries, 12)
    expect(result.visible).toEqual(entries.slice(0, 11))
    expect(result.hiddenCount).toBe(5)
  })
})

describe('eagerPreviewIDs', () => {
  function mirroredCard(id: string, mirrorPath: string): Card {
    return { ID: id, KindID: 'kind-doc', Title: id, ParentID: 'p', MirrorPath: mirrorPath } as Card
  }
  function noMirrorCard(id: string): Card {
    return { ID: id, KindID: 'kind-doc', Title: id, ParentID: 'p' } as Card
  }

  it('takes the first N mirrored children in order', () => {
    const children = [mirroredCard('a', '/a.md'), mirroredCard('b', '/b.md'), mirroredCard('c', '/c.md'), mirroredCard('d', '/d.md')]
    expect(eagerPreviewIDs(children, 3)).toEqual(new Set(['a', 'b', 'c']))
  })

  it('skips non-mirrored children when counting toward the limit', () => {
    const children = [noMirrorCard('x'), mirroredCard('a', '/a.md'), noMirrorCard('y'), mirroredCard('b', '/b.md')]
    expect(eagerPreviewIDs(children, 3)).toEqual(new Set(['a', 'b']))
  })

  it('passes every mirrored child through when under the limit', () => {
    const children = [mirroredCard('a', '/a.md'), mirroredCard('b', '/b.md')]
    expect(eagerPreviewIDs(children, 3)).toEqual(new Set(['a', 'b']))
  })
})
