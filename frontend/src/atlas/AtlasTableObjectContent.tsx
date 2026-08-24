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
// card-only affordance. Sized to TABLE_WIDTH/TABLE_HEIGHT until a
// future resize persists BoardObject.Size, matching the table CARD's
// own default footprint (atlasBoardLayout.ts) rather than inventing a
// second default.
export function AtlasTableObjectContent({ object }: { object: BoardObject }) {
  const w = object.Size?.W ?? TABLE_WIDTH
  const h = object.Size?.H ?? TABLE_HEIGHT
  return (
    <div style={{ width: w, height: h }}>
      <AtlasCardProjectionTable scopeID={object.ID} fetchProjection={AtlasService.ObjectListProjection} />
    </div>
  )
}
