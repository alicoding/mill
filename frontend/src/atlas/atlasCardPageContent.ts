import type { Card, Link, LinkKind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
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
  const docs = kids.filter((c) => !isGroupCard(allCards, c)).sort(byTitleThenID)
  const groups = kids.filter((c) => isGroupCard(allCards, c)).sort(byTitleThenID)
  return [...docs, ...groups]
}

export interface ContentLink {
  link: Link
  other: Card | undefined
  linkKind: LinkKind | undefined
}

// orderContentLinks is the page's own "Link" ordering: every link
// touching cardID (either direction), stable-sorted by the OTHER
// card's link-kind label first, then that card's own title.
export function orderContentLinks(
  links: Link[],
  cardID: string,
  cardByID: Map<string, Card>,
  linkKindByID: Map<string, LinkKind>,
): ContentLink[] {
  const touching = links.filter((l) => l.FromCardID === cardID || l.ToCardID === cardID)
  const entries = touching.map((link) => {
    const otherID = link.FromCardID === cardID ? link.ToCardID : link.FromCardID
    return { link, other: cardByID.get(otherID), linkKind: linkKindByID.get(link.LinkKindID) }
  })
  return entries.sort((a, b) => {
    const aKind = a.linkKind?.Label ?? ''
    const bKind = b.linkKind?.Label ?? ''
    if (aKind !== bKind) return aKind < bKind ? -1 : 1
    const aTitle = a.other?.Title ?? ''
    const bTitle = b.other?.Title ?? ''
    if (aTitle !== bTitle) return aTitle < bTitle ? -1 : 1
    return a.link.ID < b.link.ID ? -1 : a.link.ID > b.link.ID ? 1 : 0
  })
}

// personInitial renders a person row's own avatar letter (the card's
// own title, e.g. "Ada Lovelace" -> "A") -- distinct from a kind
// glyph's initial (the KIND's label), since a person avatar identifies
// WHICH person, not which kind every contact already shares.
export function personInitial(title: string): string {
  return (title.trim().charAt(0) || '?').toUpperCase()
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
