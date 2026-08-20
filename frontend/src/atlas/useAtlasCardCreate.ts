import { ViewMode, type Card, type Position } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { Type as FieldType, type Field } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'
import { AtlasService, ConfigureService } from '../shared/bindings'
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

  // Table from scratch (goal 0135): the List and its projection land
  // in ONE action -- a starter schema plus empty rows, shaped in
  // place afterwards with the grid's own rename/insert affordances.
  // The title doubles as the new List's label (the same prefill
  // convention the from-a-List path uses in reverse).
  const createTableFromScratch = async (kindID: string, title: string) => {
    const column = (key: string, label: string): Field => ({
      Key: key, Label: label, Type: FieldType.TypeText, Required: false, Default: '', Description: '',
      Options: null, Suggestions: null, Secret: false, RefKind: '', Multiline: false, SystemManaged: false,
    })
    const created = await ConfigureService.CreateList(title, '', [column('item', 'Item'), column('notes', 'Notes')])
    for (let i = 0; i < 3; i++) await ConfigureService.AddListRow(created.ID, {})
    const position: Position | null = freeChildPosition(allCards, viewedID, { width: TABLE_WIDTH, height: TABLE_HEIGHT })
    await AtlasService.CreateListProjectionCard(kindID, title, viewedID, position, created.ID)
    await refreshAtlas()
  }

  return { createCard, createTableCard, createTableFromScratch }
}
