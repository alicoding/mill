import type { Card, Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'

// Pure derivations over the Atlas card/kind graph -- kept dependency-
// free (no store, no Wails calls) so they're unit-testable the way
// composition/canvasLayout.ts's collision math is, and so both space
// renderers (canvas/shelves) and the breadcrumb/lens chrome share one
// implementation instead of each re-deriving it.

// A safety cap on ancestor-walk depth: the backend already rejects a
// containment cycle at write time (atlas.WouldCycle), but a pure
// frontend helper walking ParentID chains should never spin forever
// against a data shape it didn't itself validate.
const MAX_ANCESTOR_DEPTH = 1000

export function childrenOf(cards: Card[], parentID: string): Card[] {
  return cards.filter((c) => c.ParentID === parentID)
}

// The one root card (ParentID === "") when exactly one exists, else
// null -- the egocentric-root predicate (ADR-0038's egocentric-root
// principle): AtlasView's auto-entry effect drills straight into this
// card on load instead of landing on the virtual "All spaces" meta
// level, and AtlasBreadcrumb suppresses that meta level's own crumb
// under the same condition. Neither reads true (auto-entry, crumb
// suppression) when a second root card exists or none does.
export function singleRootCard(cards: Card[]): Card | null {
  const roots = cards.filter((c) => c.ParentID === '')
  return roots.length === 1 ? roots[0] : null
}

// Cards grouped into one shelf per Kind that actually has a card among
// `cards`, ordered by `kinds`' own declared order (a user's own
// Kind-list order, not alphabetical) -- shelves mode's "one labeled
// shelf per kind that has cards" rule (docs/goals/0061).
export interface KindShelf {
  kind: Kind
  cards: Card[]
}

export function groupByKind(cards: Card[], kinds: Kind[]): KindShelf[] {
  const byKindID = new Map<string, Card[]>()
  for (const c of cards) {
    const bucket = byKindID.get(c.KindID)
    if (bucket) bucket.push(c)
    else byKindID.set(c.KindID, [c])
  }
  const shelves: KindShelf[] = []
  for (const kind of kinds) {
    const bucket = byKindID.get(kind.ID)
    if (bucket && bucket.length > 0) shelves.push({ kind, cards: bucket })
  }
  return shelves
}

// The ancestor chain from (but not including) the virtual root down to
// (and including) `viewedID`, oldest first -- what AtlasBreadcrumb
// renders after its own always-present "root" crumb. An empty
// viewedID (already at root) returns an empty path. A viewedID that
// doesn't resolve to a real card (already deleted, e.g. by a
// concurrent live-sync edit) stops the walk where it is rather than
// throwing.
export function buildBreadcrumbPath(cards: Card[], viewedID: string): Card[] {
  if (!viewedID) return []
  const byID = new Map(cards.map((c) => [c.ID, c]))
  const path: Card[] = []
  let cur: string = viewedID
  for (let i = 0; i < MAX_ANCESTOR_DEPTH && cur; i++) {
    const card = byID.get(cur)
    if (!card) break
    path.unshift(card)
    cur = card.ParentID
  }
  return path
}

// The hidden-kind-ID set from a SetLens/Lens call, applied to a card
// list -- shared by both space renderers so "lens hides a kind" means
// the exact same filter regardless of which view mode is active.
export function applyLens(cards: Card[], hiddenKindIDs: string[]): Card[] {
  if (hiddenKindIDs.length === 0) return cards
  const hidden = new Set(hiddenKindIDs)
  return cards.filter((c) => !hidden.has(c.KindID))
}
