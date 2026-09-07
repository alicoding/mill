import type { Card, Link, LinkKind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'

// Pure derivations over the Atlas card/link graph (docs/goals/0064):
// the traceability matrix and the two coverage counts, both computed
// here from data the AtlasView-level store already fetched (no new
// storage, no new bound method -- kept dependency-free like
// atlasGrouping.ts's own projections, and unit-testable the same way).

// --- Traceability matrix ---

export interface MatrixTarget {
  cardID: string
  title: string
}

export interface MatrixRow {
  card: Card
  // One cell per column, aligned by index with the returned columns
  // array -- an empty array is a genuinely absent cell (rendered as an
  // explicit "None", never ambiguous blank, per ux-writing.md).
  cells: MatrixTarget[][]
}

export interface TraceabilityMatrix {
  columns: LinkKind[]
  rows: MatrixRow[]
}

// buildTraceabilityMatrix pivots a space's own cards of one chosen
// Kind against link kinds: one column per LinkKind (or, when
// filterLinkKindID names one, a single column for just that kind), one
// row per row card, each cell holding the OTHER card's title for every
// OUTGOING link (row card is the link's FromCardID) of that column's
// kind. Direction is deliberately one-way (outgoing only) -- a link
// already carries a direction, and a traceability matrix's own
// row-drives-column shape only makes sense read one way; the incoming
// side is exactly the same matrix from the target kind's own row
// perspective.
export function buildTraceabilityMatrix(
  rowCards: Card[],
  links: Link[],
  linkKinds: LinkKind[],
  cardTitleByID: Map<string, string>,
  filterLinkKindID: string,
): TraceabilityMatrix {
  const columns = filterLinkKindID ? linkKinds.filter((lk) => lk.ID === filterLinkKindID) : linkKinds
  const rows = rowCards.map((card) => {
    const cells = columns.map((col) => {
      const targets: MatrixTarget[] = []
      for (const l of links) {
        if (l.FromCardID !== card.ID || l.LinkKindID !== col.ID) continue
        targets.push({ cardID: l.ToCardID, title: cardTitleByID.get(l.ToCardID) ?? l.ToCardID })
      }
      return targets
    })
    return { card, cells }
  })
  return { columns, rows }
}

// --- Coverage ---

export interface CoverageResult {
  total: number
  missing: Card[]
}

// coverageMissingLink reports, among `cards`, which ones touch NO link
// (as either end) of linkKindID -- "known, not mapped" for a relation
// a space is expected to carry.
export function coverageMissingLink(cards: Card[], links: Link[], linkKindID: string): CoverageResult {
  const covered = new Set<string>()
  for (const l of links) {
    if (l.LinkKindID !== linkKindID) continue
    covered.add(l.FromCardID)
    covered.add(l.ToCardID)
  }
  return { total: cards.length, missing: cards.filter((c) => !covered.has(c.ID)) }
}

// coverageMissingMirror reports, among `cards`, which ones have no
// MirrorPath set yet -- "known, not mapped" for the mirror-content
// capability itself.
export function coverageMissingMirror(cards: Card[]): CoverageResult {
  return { total: cards.length, missing: cards.filter((c) => !c.MirrorPath) }
}
