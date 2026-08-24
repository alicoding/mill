import { ViewMode, type Card, type Position } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { refreshAtlas } from './atlasStore'
import { freeChildPosition } from './atlasContainmentPlacement'

// The + Add menu's create handlers -- split out of AtlasView.tsx at
// the 500-line limit (the view owns WHERE things land, these own the
// service calls + placement). Table's own create handlers moved to
// useAtlasTableObjectCreate.ts (goal 0179 S2): a table is a board-local
// object, not a card, so it no longer belongs in a hook named for card
// creation.
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

  return { createCard }
}
