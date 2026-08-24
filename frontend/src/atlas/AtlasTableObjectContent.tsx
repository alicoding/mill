import type { CSSProperties } from 'react'
import type { BoardObject } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { AtlasCardProjectionTable } from './AtlasCardProjectionTable'
import { TABLE_WIDTH, TABLE_HEIGHT } from './atlasBoardLayout'

// A "table" object's own persisted render (goal 0179 S2): the SAME
// shared grid a table CARD's board face/page already mount
// (AtlasCardProjectionTable), pointed at ObjectListProjection instead
// of CardListProjection -- no new rendering, the relocation is only
// which entity resolves the listID. A table object carries no
// ProjectionDensity of its own (that's a Card-only field); Promote to
// card is how a table object reaches the pills density and every other
// card-only affordance.
//
// Two distinct height regimes (goal 0199 part C): once a resize
// persists BoardObject.Size, that box wins forever -- this renders at
// exactly 100% of the ancestor .content box AtlasBoardObjectNode.tsx
// already sized from it, never recomputing. Before any resize, there
// is no persisted opinion to honor, so the box follows the row count
// instead of a fixed default: height stays auto (the grid's own
// content, header + however many rows) up to TABLE_HEIGHT as a
// ceiling -- past that the grid's own internal scroll (shared/
// ListGrid.module.css's .scroll) takes over, exactly like today's
// fixed box did for a large table. Width stays TABLE_WIDTH either way
// -- the reported defect was dead space below a short table, not
// alongside a narrow one.
export function AtlasTableObjectContent({ object }: { object: BoardObject }) {
  const hasSize = !!object.Size
  const style: CSSProperties = hasSize
    ? { width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }
    : { width: TABLE_WIDTH, height: 'auto', maxHeight: TABLE_HEIGHT, display: 'flex', flexDirection: 'column' }
  return (
    <div style={style}>
      <AtlasCardProjectionTable scopeID={object.ID} fetchProjection={AtlasService.ObjectListProjection} />
    </div>
  )
}
