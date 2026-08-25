import { describe, expect, it } from 'vitest'
import type { Card, Link, LinkKind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { buildRoadmapLanes, buildTraceabilityMatrix, coverageMissingLink, coverageMissingMirror } from './atlasProjections'

function card(id: string, mirrorPath = ''): Card {
  return { ID: id, KindID: 'k1', Title: id, ParentID: '', MirrorPath: mirrorPath } as Card
}

function kindedCard(id: string, kindID: string, horizon?: string): Card {
  return { ID: id, KindID: kindID, Title: id, ParentID: '', Fields: horizon !== undefined ? { horizon } : undefined } as unknown as Card
}

const laneByKind = (c: Card) => ({ key: c.KindID, label: c.KindID })

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

describe('buildRoadmapLanes', () => {
  it('assigns a tagged card to its matching horizon bucket', () => {
    const board = buildRoadmapLanes([kindedCard('a', 'k1', 'Now')], laneByKind)
    expect(board.bucketKeys).toEqual(['now', 'next', 'then', 'unscheduled'])
    const lane = board.lanes[0]
    expect(lane.cells[0].map((c) => c.ID)).toEqual(['a'])
    expect(lane.cells[1]).toEqual([])
  })

  it('groups cards into one lane per laneKey, in first-seen order', () => {
    const cards = [kindedCard('a', 'k2', 'Now'), kindedCard('b', 'k1', 'Now')]
    const board = buildRoadmapLanes(cards, laneByKind)
    expect(board.lanes.map((l) => l.laneKey)).toEqual(['k2', 'k1'])
  })

  it('falls back to the trailing Unscheduled bucket for an absent or unrecognized tag', () => {
    const cards = [kindedCard('a', 'k1'), kindedCard('b', 'k1', 'someday')]
    const board = buildRoadmapLanes(cards, laneByKind)
    const unscheduled = board.lanes[0].cells[board.bucketKeys.length - 1]
    expect(unscheduled.map((c) => c.ID)).toEqual(['a', 'b'])
    expect(board.anyTagged).toBe(false)
  })

  it('never creates a lane for a Kind with zero cards in view', () => {
    const board = buildRoadmapLanes([kindedCard('a', 'k1', 'Now')], laneByKind)
    expect(board.lanes.map((l) => l.laneKey)).toEqual(['k1'])
  })

  it('leaves an unfilled bucket a structurally-present empty cell, and reports anyTagged once one card matches', () => {
    const cards = [kindedCard('a', 'k1', 'Now'), kindedCard('b', 'k1')]
    const board = buildRoadmapLanes(cards, laneByKind)
    const cells = board.lanes[0].cells
    expect(cells[0].map((c) => c.ID)).toEqual(['a'])
    expect(cells[1]).toEqual([])
    expect(cells[2]).toEqual([])
    expect(cells[3].map((c) => c.ID)).toEqual(['b'])
    expect(board.anyTagged).toBe(true)
  })
})
