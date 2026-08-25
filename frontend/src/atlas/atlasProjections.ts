import type { Card, Link, LinkKind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { Type as FieldType } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'
import type { Field } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'

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

// --- Roadmap ---

// HORIZON_FIELD_KEY is the Roadmap view's own tag family
// (docs/goals/0212): an ordinary Kind-declared Options field
// (Card.Fields[HORIZON_FIELD_KEY]), not a dedicated Card/Kind struct
// member -- zero schema change to the domain model, and any Kind
// opts a card into a roadmap lane the same way a user declares any
// other field. A card whose value matches none of HORIZON_BUCKETS --
// absent, blank, or an unrecognized string -- is deliberately "no
// tag", never an error: it lands in the trailing Unscheduled bucket
// buildRoadmapLanes always appends.
export const HORIZON_FIELD_KEY = 'horizon'

export interface RoadmapBucket {
  key: string
  tagValue: string
}

export const HORIZON_BUCKETS: RoadmapBucket[] = [
  { key: 'now', tagValue: 'Now' },
  { key: 'next', tagValue: 'Next' },
  { key: 'then', tagValue: 'Then' },
]

export const UNSCHEDULED_BUCKET_KEY = 'unscheduled'

export interface RoadmapLane {
  laneKey: string
  laneLabel: string
  // One cell per bucket (HORIZON_BUCKETS plus the trailing Unscheduled
  // catch-all), aligned by index -- an empty array is a genuinely
  // empty cell, rendered as an honest placeholder, never blank (same
  // MatrixRow cells contract above).
  cells: Card[][]
}

export interface RoadmapBoard {
  // Bucket keys in column order, HORIZON_BUCKETS' own keys plus
  // UNSCHEDULED_BUCKET_KEY last.
  bucketKeys: string[]
  // Only Kinds with at least one card in view get a lane (design
  // contract: "rows = Kinds that have any card in view").
  lanes: RoadmapLane[]
  // True once at least one card in view carries a recognized horizon
  // tag -- the view's own all-untagged empty state reads this,
  // distinct from a single empty CELL within an otherwise-tagged board.
  anyTagged: boolean
}

// effectiveBucketKeyForCard resolves the one bucket a card currently
// sits in -- a HORIZON_BUCKETS key, or UNSCHEDULED_BUCKET_KEY for an
// absent/unrecognized tag. The single source of truth buildRoadmapLanes
// below, the picker's own candidate filter, and the drag/drop target
// check (goal 0225) all read, so a card's column placement can never
// disagree between them.
export function effectiveBucketKeyForCard(card: Card, horizonBuckets: RoadmapBucket[] = HORIZON_BUCKETS): string {
  const tag = card.Fields?.[HORIZON_FIELD_KEY] ?? ''
  const idx = horizonBuckets.findIndex((b) => b.tagValue === tag)
  return idx === -1 ? UNSCHEDULED_BUCKET_KEY : horizonBuckets[idx].key
}

// tagValueForBucketKey maps a column back to the Fields[horizon] value
// placing a card in it writes -- a bucket's own tagValue, or '' for
// UNSCHEDULED_BUCKET_KEY (and any unrecognized key), which is also the
// value a drop on Unscheduled clears the field to.
export function tagValueForBucketKey(bucketKey: string, horizonBuckets: RoadmapBucket[] = HORIZON_BUCKETS): string {
  return horizonBuckets.find((b) => b.key === bucketKey)?.tagValue ?? ''
}

// cardsEligibleForBucket is the "+ Place cards" picker's own candidate
// list: every card NOT already sitting in that column -- selecting a
// card already there would be a same-column no-op anyway.
export function cardsEligibleForBucket(cards: Card[], bucketKey: string, horizonBuckets: RoadmapBucket[] = HORIZON_BUCKETS): Card[] {
  return cards.filter((c) => effectiveBucketKeyForCard(c, horizonBuckets) !== bucketKey)
}

// buildHorizonKindField is the field a Kind gets auto-declared with the
// first time one of its cards is placed on the roadmap (goal 0225):
// IDENTICAL in shape to the seeded example Kinds that already declare
// this field (internal/domain/atlas/builtin.go), derived from
// HORIZON_BUCKETS itself so the two can never drift apart.
export function buildHorizonKindField(): Field {
  return {
    Key: HORIZON_FIELD_KEY,
    Label: 'Horizon',
    Type: FieldType.TypeOptions,
    Options: HORIZON_BUCKETS.map((b) => b.tagValue),
  } as Field
}

// buildRoadmapLanes pivots `cards` into lanes (grouped by whatever key/
// label `laneKey` derives per card -- Kind, in the v1 caller) against
// horizon buckets (docs/goals/0212, rides the Matrix builder's own
// shape above). Cards sharing a lane keep BuiltInCards' own order.
export function buildRoadmapLanes(
  cards: Card[],
  laneKey: (card: Card) => { key: string; label: string },
  horizonBuckets: RoadmapBucket[] = HORIZON_BUCKETS,
): RoadmapBoard {
  const bucketKeys = [...horizonBuckets.map((b) => b.key), UNSCHEDULED_BUCKET_KEY]
  const laneOrder: string[] = []
  const laneLabels = new Map<string, string>()
  const cellsByLane = new Map<string, Card[][]>()
  let anyTagged = false

  for (const card of cards) {
    const { key: lane, label: laneLabel } = laneKey(card)
    if (!cellsByLane.has(lane)) {
      cellsByLane.set(lane, bucketKeys.map(() => []))
      laneLabels.set(lane, laneLabel)
      laneOrder.push(lane)
    }
    const bucketKey = effectiveBucketKeyForCard(card, horizonBuckets)
    if (bucketKey !== UNSCHEDULED_BUCKET_KEY) anyTagged = true
    cellsByLane.get(lane)![bucketKeys.indexOf(bucketKey)].push(card)
  }

  const lanes = laneOrder.map((key) => ({ laneKey: key, laneLabel: laneLabels.get(key) ?? key, cells: cellsByLane.get(key)! }))
  return { bucketKeys, lanes, anyTagged }
}
