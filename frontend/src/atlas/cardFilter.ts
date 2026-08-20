import type { Card } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'

// The board filter's pure predicate (goal 0129 slice 1): the shared
// filter vocabulary the research verdict named -- text is the same
// case-insensitive substring over title+note the jump dialog
// established (atlasJumpFilter.ts), kinds are member-of-set, criteria
// AND together. Kept dependency-free like the jump filter so it's
// unit-testable without a store or a board.

export interface BoardFilter {
  query: string
  // Empty set = no kind criterion (every kind matches).
  kindIDs: Set<string>
}

export const EMPTY_BOARD_FILTER: BoardFilter = { query: '', kindIDs: new Set() }

export function filterIsActive(f: BoardFilter): boolean {
  return f.query.trim() !== '' || f.kindIDs.size > 0
}

// matchesBoardFilter: true when the card satisfies EVERY active
// criterion. An inactive filter matches everything -- the board's
// resting state is "nothing dimmed".
export function matchesBoardFilter(card: Card, f: BoardFilter): boolean {
  if (f.kindIDs.size > 0 && !f.kindIDs.has(card.KindID)) return false
  const q = f.query.trim().toLowerCase()
  if (q === '') return true
  return card.Title.toLowerCase().includes(q) || (card.Note ?? '').toLowerCase().includes(q)
}
