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

  // Table from scratch (goal 0137, correcting 0135's dialog): the size
  // picker's click is the WHOLE creation -- identity is automatic.
  // Kind: blank, defaulted server-side (the seed vocabulary lives
  // there, never here; it stays editable on the card page). Title:
  // "Table", uniquified against every card title so two quick tables
  // don't collide; the minted List's label mirrors it. Columns arrive
  // as "Column N" (renaming while empty re-keys from the label, the
  // 0136 semantics), rows arrive empty.
  const createTableFromScratch = async (cols: number, rowCount: number) => {
    const titles = new Set(allCards.map((c) => c.Title))
    let title = 'Table'
    for (let n = 2; titles.has(title); n++) title = `Table ${n}`
    const columns: Field[] = Array.from({ length: cols }, (_, i): Field => ({
      Key: `column-${i + 1}`, Label: `Column ${i + 1}`, Type: FieldType.TypeText,
      Required: false, Default: '', Description: '', Options: null,
      Suggestions: null, Secret: false, RefKind: '', Multiline: false, SystemManaged: false,
    }))
    const created = await ConfigureService.CreateList(title, '', columns)
    for (let i = 0; i < rowCount; i++) await ConfigureService.AddListRow(created.ID, {})
    const position: Position | null = freeChildPosition(allCards, viewedID, { width: TABLE_WIDTH, height: TABLE_HEIGHT })
    await AtlasService.CreateListProjectionCard('', title, viewedID, position, created.ID)
    await refreshAtlas()
  }

  return { createCard, createTableCard, createTableFromScratch }
}
