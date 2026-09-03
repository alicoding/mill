import type { BoardObject, Card, Kind, Note } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { buildBreadcrumbPath, singleRootCard } from './atlasGrouping'
import { isGroupCard } from './atlasBoardLayout'

// The ⌘K jump dialog's pure filter/rank (goal 0072 slice B) -- kept
// dependency-free like atlasGrouping.ts's own helpers so it's
// unit-testable without a store or a mounted board, and so the
// AtlasJumpDialog component stays a thin renderer over this.

const MAX_RESULTS = 8

// The jump dialog's "area" facet scope (goal 0086) -- a role, not a
// Kind, so it needs a sentinel distinct from any real Kind ID (Kind
// IDs are user-declared, ADR-0038 Decision 2, so this stays a
// two-underscore form no real slug is likely to collide with).
export const AREA_FACET_KEY = '__area__'

export interface AtlasJumpResult {
  card: Card
  kind: Kind | undefined
  // Ancestor titles from (but not including) the auto-entered root down
  // to (but not including) the card itself, joined by " ▸ " -- empty
  // for a card whose parent IS the auto-entered root.
  path: string
}

// The breadcrumb trail a jump result's row shows: reuses
// buildBreadcrumbPath/singleRootCard rather than re-walking ParentID
// chains, so "which ancestor is the auto-entered root" stays defined
// in exactly one place (atlasGrouping.ts).
export function ancestorPathLabel(cards: Card[], card: Card): string {
  return ancestorPathFromParent(cards, card.ParentID)
}

function stableSortResults(results: AtlasJumpResult[]): AtlasJumpResult[] {
  return [...results].sort((a, b) => {
    if (a.card.Title !== b.card.Title) return a.card.Title < b.card.Title ? -1 : 1
    if (a.card.ID === b.card.ID) return 0
    return a.card.ID < b.card.ID ? -1 : 1
  })
}

// filterJumpCards: case-insensitive substring match, title first (rank
// 0) then note (rank 1), title-ascending within a rank, capped at the
// dialog's own max visible rows. An empty, unscoped query returns no
// results -- the dialog has nothing useful to show until the user
// types or picks a facet. `scopeKey` narrows the candidate set FIRST
// (goal 0086's faceted search: a Kind's ID, or AREA_FACET_KEY for
// group-card "areas") -- once scoped, an empty query still lists every
// candidate of that scope (title-ascending), since the facet itself is
// already a specific enough ask.
export function filterJumpCards(cards: Card[], kinds: Kind[], query: string, scopeKey?: string, allNotes: Note[] = [], allObjects: BoardObject[] = []): AtlasJumpResult[] {
  const q = query.trim().toLowerCase()
  if (!q && !scopeKey) return []

  const kindByID = new Map(kinds.map((k) => [k.ID, k]))
  const candidates = scopeKey === AREA_FACET_KEY
    ? cards.filter((c) => isGroupCard(cards, c, allNotes, allObjects))
    : scopeKey
      ? cards.filter((c) => c.KindID === scopeKey)
      : cards

  if (!q) {
    const wrapped = candidates.map((card) => ({ card, kind: kindByID.get(card.KindID), path: ancestorPathLabel(cards, card) }))
    return stableSortResults(wrapped).slice(0, MAX_RESULTS)
  }

  const byRank: AtlasJumpResult[][] = [[], []]
  for (const card of candidates) {
    const rank = card.Title.toLowerCase().includes(q) ? 0 : (card.Note ?? '').toLowerCase().includes(q) ? 1 : null
    if (rank === null) continue
    byRank[rank].push({ card, kind: kindByID.get(card.KindID), path: ancestorPathLabel(cards, card) })
  }

  return [...stableSortResults(byRank[0]), ...stableSortResults(byRank[1])].slice(0, MAX_RESULTS)
}

export interface AtlasJumpObjectResult {
  object: BoardObject
  label: string
  path: string
}

// objectJumpLabel: what a board object answers to in search (goal
// 0265) -- objects deliberately render no title on the board
// (AtlasBoardObjectNode.tsx's own contract), but they still have a
// findable name: the creation-time title (file-drop kinds store
// titleFromFilename), else the mirror file's own basename, else the
// Kind itself, capitalized (honest for plugin kinds whose slug is all
// that exists).
export function objectJumpLabel(object: BoardObject): string {
  const title = object.Payload?.title?.trim()
  if (title) return title
  const mirror = object.Payload?.mirrorPath
  if (mirror) {
    const base = mirror.split('/').pop() ?? mirror
    if (base) return base
  }
  return object.Kind.charAt(0).toUpperCase() + object.Kind.slice(1)
}

function stableSortObjectResults(results: AtlasJumpObjectResult[]): AtlasJumpObjectResult[] {
  return [...results].sort((a, b) => {
    if (a.label !== b.label) return a.label < b.label ? -1 : 1
    if (a.object.ID === b.object.ID) return 0
    return a.object.ID < b.object.ID ? -1 : 1
  })
}

// filterJumpObjects: the object half of the jump dialog's results
// (goal 0265) -- same case-insensitive substring match over the
// label, same cap. Facet scopes stay card-vocabulary (Kind IDs and
// the area role), so a scoped query returns no objects by design.
export function filterJumpObjects(objects: BoardObject[], cards: Card[], query: string, scopeKey?: string): AtlasJumpObjectResult[] {
  const q = query.trim().toLowerCase()
  if (!q || scopeKey) return []
  const matches: AtlasJumpObjectResult[] = []
  for (const object of objects) {
    const label = objectJumpLabel(object)
    if (!label.toLowerCase().includes(q)) continue
    matches.push({
      object,
      label,
      path: ancestorPathFromParent(cards, object.ParentID),
    })
  }
  return stableSortObjectResults(matches).slice(0, MAX_RESULTS)
}

// The breadcrumb trail for anything filed under a card by ParentID --
// the object counterpart of ancestorPathLabel above, sharing the same
// root-elision rule.
export function ancestorPathFromParent(cards: Card[], parentID: string): string {
  const root = singleRootCard(cards)
  const ancestors = buildBreadcrumbPath(cards, parentID)
  const named = root ? ancestors.filter((c) => c.ID !== root.ID) : ancestors
  return named.map((c) => c.Title).join(' ▸ ')
}
