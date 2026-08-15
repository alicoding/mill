import { describe, expect, it } from 'vitest'
import type { Card, Link, LinkKind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { buildTraceabilityMatrix, coverageMissingLink, coverageMissingMirror } from './atlasProjections'

function card(id: string, mirrorPath = ''): Card {
  return { ID: id, KindID: 'k1', Title: id, ParentID: '', MirrorPath: mirrorPath } as Card
}

function link(from: string, to: string, linkKindID: string): Link {
  return { ID: `${from}-${to}`, FromCardID: from, ToCardID: to, LinkKindID: linkKindID } as Link
}

function linkKind(id: string, label = id): LinkKind {
  return { ID: id, Label: label } as LinkKind
}

describe('buildTraceabilityMatrix', () => {
  it('produces one column per link kind and resolves target titles', () => {
    const a = card('a')
    const b = card('b')
    const cards = [a, b]
    const links = [link('a', 'b', 'lk1')]
    const linkKinds = [linkKind('lk1', 'relates to'), linkKind('lk2', 'depends on')]
    const titles = new Map(cards.map((c) => [c.ID, c.Title]))

    const matrix = buildTraceabilityMatrix(cards, links, linkKinds, titles, '')
    expect(matrix.columns.map((c) => c.ID)).toEqual(['lk1', 'lk2'])
    expect(matrix.rows[0].cells[0]).toEqual([{ cardID: 'b', title: 'b' }])
    expect(matrix.rows[0].cells[1]).toEqual([])
    expect(matrix.rows[1].cells[0]).toEqual([])
  })

  it('narrows to a single column when filterLinkKindID names one', () => {
    const cards = [card('a')]
    const linkKinds = [linkKind('lk1'), linkKind('lk2')]
    const matrix = buildTraceabilityMatrix(cards, [], linkKinds, new Map(), 'lk2')
    expect(matrix.columns.map((c) => c.ID)).toEqual(['lk2'])
  })

  it('only counts OUTGOING links -- the row card must be FromCardID', () => {
    const a = card('a')
    const links = [link('b', 'a', 'lk1')]
    const linkKinds = [linkKind('lk1')]
    const titles = new Map([['a', 'a'], ['b', 'b']])
    const matrix = buildTraceabilityMatrix([a], links, linkKinds, titles, '')
    expect(matrix.rows[0].cells[0]).toEqual([])
  })
})

describe('coverageMissingLink', () => {
  it('reports cards touching no link of the chosen kind, as either end', () => {
    const a = card('a')
    const b = card('b')
    const c = card('c')
    const links = [link('a', 'b', 'lk1')]
    const result = coverageMissingLink([a, b, c], links, 'lk1')
    expect(result.total).toBe(3)
    expect(result.missing.map((m) => m.ID)).toEqual(['c'])
  })

  it('ignores links of a different kind', () => {
    const a = card('a')
    const b = card('b')
    const links = [link('a', 'b', 'other-kind')]
    const result = coverageMissingLink([a, b], links, 'lk1')
    expect(result.missing.map((m) => m.ID)).toEqual(['a', 'b'])
  })
})

describe('coverageMissingMirror', () => {
  it('reports cards with no MirrorPath set', () => {
    const a = card('a', '/tmp/a.md')
    const b = card('b', '')
    const result = coverageMissingMirror([a, b])
    expect(result.total).toBe(2)
    expect(result.missing.map((m) => m.ID)).toEqual(['b'])
  })
})
