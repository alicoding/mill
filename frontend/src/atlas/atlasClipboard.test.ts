import { describe, expect, it } from 'vitest'
import { parseAtlasClonePayload, serializeAtlasSelection, subtreeSize } from './atlasClipboard'
import type { Card, Note, Link } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'

const card = (id: string, parent: string, x = 0, y = 0): Card => ({
  ID: id, KindID: 'k1', Title: id, Note: `n-${id}`, Fields: { a: '1' }, ParentID: parent,
  Position: { X: x, Y: y }, ViewMode: '', Source: '', MirrorPath: '/secret/mirror.md', MirrorChecksum: 'x',
} as unknown as Card)
const note = (id: string, parent: string, x = 0, y = 0): Note => ({ ID: id, Text: `t-${id}`, ParentID: parent, Position: { X: x, Y: y } } as unknown as Note)
const link = (from: string, to: string): Link => ({ ID: `${from}-${to}`, FromCardID: from, ToCardID: to, LinkKindID: 'lk', Label: '' } as unknown as Link)

describe('atlasClipboard', () => {
  it('serializes selected cards/notes with relative positions and set-scoped links; mirror fields never enter', () => {
    const cards = [card('a', 'root', 100, 100), card('b', 'root', 300, 100), card('c', 'root', 900, 900)]
    const links = [link('a', 'b'), link('b', 'c')]
    const p = serializeAtlasSelection(cards, [note('n1', 'root', 100, 200)], links, ['a', 'b'], ['n1'])!
    expect(p.cards.map((c) => c.title)).toEqual(['a', 'b'])
    expect(p.cards[1]).toMatchObject({ dx: 200, dy: 0 })
    expect(p.links).toEqual([{ source: 0, target: 1, linkKindID: 'lk', label: '' }])
    expect(JSON.stringify(p)).not.toContain('mirror')
  })

  it('counts the full subtree and records intra-set parentage', () => {
    const cards = [card('frame', 'root'), card('kid', 'frame'), card('grandkid', 'kid')]
    const notes = [note('nk', 'frame')]
    expect(subtreeSize(cards, notes, 'frame')).toBe(3)
    const p = serializeAtlasSelection(cards, notes, [], ['frame', 'kid'], [])!
    // kid rides inside the cloned frame; frame parents to the paste target.
    expect(p.cards[0].parentIdx).toBeNull()
    expect(p.cards[1].parentIdx).toBe(0)
  })

  it('parse refuses prose, other JSON, and the workflow surface', () => {
    expect(parseAtlasClonePayload('hello')).toBeNull()
    expect(parseAtlasClonePayload('{"mill":"clone","surface":"workflow","v":1,"nodes":[],"notes":[],"edges":[]}')).toBeNull()
  })
})
