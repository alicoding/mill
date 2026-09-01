import { useState } from 'react'
import type { BoardObject, Card, Note } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { childrenOf } from './atlasGrouping'
import { isGroupCard } from './atlasBoardLayout'
import { type BoardFilter, EMPTY_BOARD_FILTER, matchesBoardFilter } from './cardFilter'

// The board filter's state + counting (goal 0129 slice 1) -- split
// out of AtlasView.tsx at the 500-line limit. Transient by design:
// session-local, survives drills, never persisted (the hide-kinds
// lens is the persistent concept; this is a question, not a
// configuration). Counting covers what the board actually RENDERS as
// leaf cards: the level's non-group cards plus each frame's one-level
// preview children -- frames are structure, never counted or dimmed.
export function useAtlasBoardFilter(boardAllCards: Card[], viewedID: string, allNotes: Note[], allObjects: BoardObject[]) {
  const [boardFilter, setBoardFilter] = useState<BoardFilter>(EMPTY_BOARD_FILTER)
  const level = childrenOf(boardAllCards, viewedID)
  const renderedLeaves = [
    ...level.filter((c) => !isGroupCard(boardAllCards, c, allNotes, allObjects)),
    ...level.filter((c) => isGroupCard(boardAllCards, c, allNotes, allObjects)).flatMap((g) => childrenOf(boardAllCards, g.ID).filter((c) => !isGroupCard(boardAllCards, c, allNotes, allObjects))),
  ]
  return {
    boardFilter,
    setBoardFilter,
    filterMatchCount: renderedLeaves.filter((c) => matchesBoardFilter(c, boardFilter)).length,
    filterTotalCount: renderedLeaves.length,
    filterPresentKindIDs: new Set(renderedLeaves.map((c) => c.KindID)),
  }
}
