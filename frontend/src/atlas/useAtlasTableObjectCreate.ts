import type { BoardObject, Card, Note, Position } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { refreshAtlas } from './atlasStore'
import type { MutableRefObject } from 'react'
import { freeChildPosition } from './atlasContainmentPlacement'
import type { FreePlacement } from './atlasFreePlacement'
import { TABLE_HEIGHT, TABLE_WIDTH } from './atlasBoardLayout'
import { tableTool } from './tools/tableTool'

// The table tool's own placement door (goal 0179 S2, re-pointed the
// same way useAtlasImageCreate.ts/useAtlasShapeCreate.ts already were
// by S1): dropping a spreadsheet or picking a size lands a "table"
// BoardObject -- a peer to Card, never a card itself. Table/diagram are
// a RELOCATION of machinery that already worked (goal 0105/0137's own
// List-projection minting), not a new capability -- both handlers below
// still mint/resolve the List exactly as before; only the placement
// call target changed.
// allNotes/allObjects: the placement clears every sibling's REAL
// footprint, and a group card's frame is sized by its notes and
// objects too -- without them a gallery frame full of objects reads
// as note-sized and the new table lands inside it (goal 0287 S3).
export function useAtlasTableObjectCreate({ allCards, allNotes, allObjects, viewedID, freePlacementRef }: { allCards: Card[]; allNotes: Note[]; allObjects: BoardObject[]; viewedID: string; freePlacementRef?: MutableRefObject<FreePlacement | null> }) {
  // The board's measured placement when it is mounted and the target is
  // the viewed board; stored-position placement otherwise.
  const freePosition = (targetParent: string, size: { width: number; height: number }): Position =>
    (targetParent === viewedID && freePlacementRef?.current ? freePlacementRef.current(size) : freeChildPosition(allCards, targetParent, size, allNotes, allObjects))
  // Table from a List (goal 0105): always lands inside the current
  // space -- a projection is content of the board being viewed.
  const createTableFromList = async (listID: string, parentIDOverride?: string): Promise<BoardObject> => {
    const targetParent = parentIDOverride ?? viewedID
    const position: Position | null = freePosition(targetParent, { width: TABLE_WIDTH, height: TABLE_HEIGHT })
    const created = await AtlasService.CreateBoardObject('table', { listID }, position ?? { X: 0, Y: 0 }, targetParent)
    await refreshAtlas()
    return created
  }

  // Table from scratch (goal 0137, correcting 0135's dialog): the size
  // picker's click is the WHOLE creation -- identity is automatic.
  // Title: "Table", uniquified against every card title so two quick
  // tables don't collide; the minted List's label mirrors it
  // (tableTool.commit, atlasTools.ts). Columns arrive as "Column N"
  // (renaming while empty re-keys from the label, the 0136 semantics),
  // rows arrive empty. No Kind is asked or resolved -- a board object
  // carries none; Promote to card is where a Kind first applies.
  const createTableFromScratch = async (cols: number, rowCount: number, at?: { X: number; Y: number }, parentIDOverride?: string) => {
    const existingTitles = new Set(allCards.map((c) => c.Title))
    const artifact = await tableTool.commit({ cols, rowCount, existingTitles })
    const targetParent = parentIDOverride ?? viewedID
    const position: Position | null = at ?? freePosition(targetParent, { width: TABLE_WIDTH, height: TABLE_HEIGHT })
    await AtlasService.CreateBoardObject('table', { listID: artifact.listID, title: artifact.title }, position ?? { X: 0, Y: 0 }, targetParent)
    await refreshAtlas()
  }

  return { createTableFromList, createTableFromScratch }
}
