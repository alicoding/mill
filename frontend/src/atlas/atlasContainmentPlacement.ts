import type { Card } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { childrenOf } from './atlasGrouping'
import { computeGroupFrameLayout, isGroupCard, NOTE_HEIGHT, NOTE_WIDTH } from './atlasBoardLayout'
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
export function freeChildPosition(allCards: Card[], parentID: string): { X: number; Y: number } {
  const siblings = childrenOf(allCards, parentID).filter((c) => c.Position)
  const desired = findFreeDropPosition(
    { x: 80, y: 80 },
    siblings.map((c) => ({
      position: { x: c.Position?.X ?? 0, y: c.Position?.Y ?? 0 },
      dims: isGroupCard(allCards, c) ? computeGroupFrameLayout(allCards, c.ID).size : { width: NOTE_WIDTH, height: NOTE_HEIGHT },
    })),
    { width: NOTE_WIDTH, height: NOTE_HEIGHT },
  )
  return { X: desired.x, Y: desired.y }
}
