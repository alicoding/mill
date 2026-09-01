import type { Card, Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { Type as ConfigFieldType } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'
import type { Field } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'
import { childrenOf } from './atlasGrouping'
import { isGroupCard } from './atlasBoardLayout'

// Pure derivations behind the card page's Contents column (goal 0072
// slice C) -- kept dependency-free like atlasGrouping.ts/
// atlasCardPresentation.ts so the page's own ordering rules are
// independently unit-testable, not re-derived ad hoc inside the
// component that renders them.

// The seeded person-kind example's own stable id (internal/domain/
// atlas/builtin.go) -- a targeted match against ONE known seeded
// example, not a general Kind-category concept the domain model
// doesn't carry yet (ADR-0038 Decision 2 keeps Kind identity user
// data): a custom person-like Kind a user declares themselves renders
// the plain square glyph/no avatar until Kind carries a real category
// field of its own.
const SEEDED_PERSON_KIND_ID = 'atlas-kind-contact'

export function isPersonKind(kindID: string): boolean {
  return kindID === SEEDED_PERSON_KIND_ID
}

// The card page's own kind-appropriate-fields derivation (goal 0081
// slice A5, LOCKED design 5b): Source/Mirror path only render on a
// kind whose cards can actually carry them. Kind carries no declared
// "mirrors" property of its own yet (that capability belongs to slice
// B's kind editor) -- these two IDs are the only kinds any built-in
// path ever writes Source/MirrorPath into: one seeded example ships
// with a Source of its own (internal/domain/atlas/builtin.go), and the
// file-drop door (atlasservice_filedrop.go's fileDropProseKindID/
// fileDropReferenceKindID) lands a dropped file's MirrorPath on
// whichever of these two IDs matches the file's own extension, never
// any other kind. Same "one targeted literal-ID match against a known
// seeded example, not a general category" precedent isPersonKind above
// already established.
const MIRROR_BEARING_KIND_IDS = new Set(['atlas-kind-document', 'atlas-kind-reference'])

export function isMirrorKind(kindID: string): boolean {
  return MIRROR_BEARING_KIND_IDS.has(kindID)
}

// The calm page's own "existing status control" (goal 0106 slice B
// contract item 3's property-strip chip): a convention-matched field,
// not a dedicated Card.Status column -- Card carries no such field
// (ADR-0038 Decision 2, structure not concept), so "status" is
// whatever ordinary typedfield.Field a Kind chooses to declare with
// this exact key, same "match a known field shape, not a Kind
// identity" precedent isPersonKind/isMirrorKind above already
// establish one level up (by Kind.ID rather than Field.Key). More than
// one built-in Kind declares exactly this shape (internal/domain/
// atlas/builtin.go); a user-declared Kind gets the same chip treatment
// for free by declaring its own Options field keyed "status". Gated to
// TypeOptions specifically -- a differently-typed field a user happens
// to key "status" has no Options list to render as a chip's control,
// so it stays an ordinary field in the fields column instead.
export function statusFieldOf(kind: Kind | undefined): Field | undefined {
  return kind?.Fields?.find((f) => f.Key === 'status' && f.Type === ConfigFieldType.TypeOptions)
}

function byTitleThenID(a: Card, b: Card): number {
  if (a.Title !== b.Title) return a.Title < b.Title ? -1 : 1
  return a.ID < b.ID ? -1 : a.ID > b.ID ? 1 : 0
}

// orderContentChildren is the page's own "Inside" ordering: every
// direct child, non-group cards first then group cards, each bucket
// stable-sorted by title -- independent of the board's own auto-
// arrange/free layout, since the page is a read list, not a canvas.
export function orderContentChildren(allCards: Card[], parentID: string): Card[] {
  const kids = childrenOf(allCards, parentID)
  // Deliberately cards-only ([], []): the page's docs/groups split
  // orders CARD children of a read list -- a child that is a frame
  // solely via filed notes/objects still lists as a document here,
  // which matches the page's document framing (goal 0266's one
  // recorded divergence from the frame-role law).
  const docs = kids.filter((c) => !isGroupCard(allCards, c, [], [])).sort(byTitleThenID)
  const groups = kids.filter((c) => isGroupCard(allCards, c, [], [])).sort(byTitleThenID)
  return [...docs, ...groups]
}

// The page's own semantic zoom (goal 0073 slice B): a page with
// hundreds of entries must stay bounded the same way a board frame
// already is (atlasBoardLayout.ts's preview cap), with an honest,
// explicit expander rather than a silent truncation -- capPageEntries
// always reserves one slot for its own "Show N more" row instead of
// showing exactly `limit` entries and hiding the row that would let a
// user reach the rest. Mirror previews are the other real cost at
// scale (a Contents column rendering 100 fetched-and-rendered previews
// at once): eagerPreviewIDs bounds how many render immediately,
// leaving the remainder behind an on-demand button.
export interface CappedEntries<T> {
  visible: T[]
  hiddenCount: number
}

export function capPageEntries<T>(entries: T[], limit = 12): CappedEntries<T> {
  if (entries.length <= limit) return { visible: entries, hiddenCount: 0 }
  const visible = entries.slice(0, limit - 1)
  return { visible, hiddenCount: entries.length - visible.length }
}

export function eagerPreviewIDs(children: Card[], limit = 3): Set<string> {
  const mirrored = children.filter((c) => c.MirrorPath)
  return new Set(mirrored.slice(0, limit).map((c) => c.ID))
}
