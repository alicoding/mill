import type { Card, Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { buildBreadcrumbPath, singleRootCard } from './atlasGrouping'

// The ⌘K jump dialog's pure filter/rank (goal 0072 slice B) -- kept
// dependency-free like atlasGrouping.ts's own helpers so it's
// unit-testable without a store or a mounted board, and so the
// AtlasJumpDialog component stays a thin renderer over this.

const MAX_RESULTS = 8

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
  const root = singleRootCard(cards)
  const ancestors = buildBreadcrumbPath(cards, card.ParentID)
  const named = root ? ancestors.filter((c) => c.ID !== root.ID) : ancestors
  return named.map((c) => c.Title).join(' ▸ ')
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
// dialog's own max visible rows. An empty query returns no results --
// the dialog has nothing useful to show until the user types.
export function filterJumpCards(cards: Card[], kinds: Kind[], query: string): AtlasJumpResult[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const kindByID = new Map(kinds.map((k) => [k.ID, k]))

  const byRank: AtlasJumpResult[][] = [[], []]
  for (const card of cards) {
    const rank = card.Title.toLowerCase().includes(q) ? 0 : (card.Note ?? '').toLowerCase().includes(q) ? 1 : null
    if (rank === null) continue
    byRank[rank].push({ card, kind: kindByID.get(card.KindID), path: ancestorPathLabel(cards, card) })
  }

  return [...stableSortResults(byRank[0]), ...stableSortResults(byRank[1])].slice(0, MAX_RESULTS)
}
