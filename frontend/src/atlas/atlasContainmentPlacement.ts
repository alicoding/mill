import type { BoardObject, Card, Note } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { childrenOf } from './atlasGrouping'
import { computeGroupFrameLayout, isGroupCard, NOTE_HEIGHT, NOTE_WIDTH, TABLE_HEIGHT, TABLE_WIDTH } from './atlasBoardLayout'
import { findFreeDropPosition } from '../shared/canvasLayout'

// A fresh, collision-avoidant Position for a card or note about to be
// filed into parentID (goal 0081 slice A2: drag filing, marker-box/
// select-group area creation, and the frame-interior "Add card to X"
// door). A card's own Position field is only ever meaningful on the
// board where viewedID equals its OWN parent (AtlasBoard.tsx's own
// header comment) -- a screen click's flow coordinates on a DIFFERENT
// board (the parent frame's own capped preview, or the level one
// above) can never be reused directly as the filed card's real
// position one level down, so every filing door computes a fresh spot
// among the target parent's own existing children instead. Same
// findFreeDropPosition spiral AtlasView's own sibling/child creation
// path already uses -- factored out here so both share it.
// allNotes/allObjects default empty as a stated approximation, not an
// omission: a caller without them at hand sizes a notes/objects-only
// frame as a leaf, and the overlap resolver self-heals the slight
// overlap on next render -- callers that have the data pass it.
export function freeChildPosition(allCards: Card[], parentID: string, newSize?: { width: number; height: number }, allNotes: Note[] = [], allObjects: BoardObject[] = []): { X: number; Y: number } {
  const siblings = childrenOf(allCards, parentID).filter((c) => c.Position)
  const desired = findFreeDropPosition(
    { x: 80, y: 80 },
    siblings.map((c) => ({
      position: { x: c.Position?.X ?? 0, y: c.Position?.Y ?? 0 },
      // Every sibling clears its REAL rendered footprint: a region
      // frame's computed size, a table projection's TABLE box, a
      // leaf's note box (goal 0105 -- note-sized clearance landed a
      // table card overlapping the frame beside it).
      dims: isGroupCard(allCards, c, allNotes, allObjects) ? computeGroupFrameLayout(allCards, c.ID, allNotes, allObjects).size
        : c.ProjectionListID ? { width: c.Size?.W ?? TABLE_WIDTH, height: c.Size?.H ?? TABLE_HEIGHT }
          : { width: NOTE_WIDTH, height: NOTE_HEIGHT },
    })),
    newSize ?? { width: NOTE_WIDTH, height: NOTE_HEIGHT },
  )
  return { X: desired.x, Y: desired.y }
}
