import { ViewMode, type Card, type Position } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { refreshAtlas } from './atlasStore'
import { freeChildPosition } from './atlasContainmentPlacement'
import { TABLE_HEIGHT, TABLE_WIDTH } from './atlasBoardLayout'

// The + Add menu's create handlers -- split out of AtlasView.tsx at
// the 500-line limit (the view owns WHERE things land, these own the
// service calls + placement).
export function useAtlasCardCreate({ allCards, viewedID, viewedCard }: {
  allCards: Card[]
  viewedID: string
  viewedCard: Card | null | undefined
}) {
  const createCard = async (containment: 'sibling' | 'child', kindID: string, title: string) => {
    const parentID = containment === 'child' ? viewedID : (viewedCard?.ParentID ?? '')
    // A sibling/child that itself holds children renders as a region
    // frame, far larger than a leaf note's own footprint --
    // freeChildPosition's own collision-avoidance clears its REAL
    // rendered size, not a uniform note-sized box (regression: a new
    // card once landed physically underneath an existing region frame).
    const position: Position | null = freeChildPosition(allCards, parentID)
    await AtlasService.CreateCard(kindID, title, '', {}, parentID, position, ViewMode.$zero, '', '', '')
    await refreshAtlas()
  }

  // Table from a List (goal 0105): always lands inside the current
  // space -- a projection is content of the board being viewed.
  const createTableCard = async (kindID: string, title: string, listID: string) => {
    const position: Position | null = freeChildPosition(allCards, viewedID, { width: TABLE_WIDTH, height: TABLE_HEIGHT })
    await AtlasService.CreateListProjectionCard(kindID, title, viewedID, position, listID)
    await refreshAtlas()
  }

  return { createCard, createTableCard }
}
