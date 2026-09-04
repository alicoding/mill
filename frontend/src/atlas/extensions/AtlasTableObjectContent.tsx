import { useState } from 'react'
import type { CSSProperties, ComponentProps } from 'react'
import type { BoardObject } from '../../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasCardProjectionTable } from '../AtlasCardProjectionTable'
import { TABLE_HEIGHT } from '../atlasBoardLayout'
import { tableWidthForColumns } from '../atlasTableWidth'

// FetchListProjection -- derived from AtlasCardProjectionTable's own
// prop type rather than importing ListProjection from bindings
// directly (ADR-0046, goal 0244 S1b: extensions/ has no import path to
// the generated bindings at all -- AtlasCardProjectionTable itself
// stays outside extensions/ and is free to import that type).
type FetchListProjection = ComponentProps<typeof AtlasCardProjectionTable>['fetchProjection']

// A "table" object's own persisted render (goal 0179 S2): the SAME
// shared grid a table CARD's board face/page already mount
// (AtlasCardProjectionTable), pointed at ObjectListProjection instead
// of CardListProjection -- no new rendering, the relocation is only
// which entity resolves the listID. A table object carries no
// ProjectionDensity of its own (that's a Card-only field); Promote to
// card is how a table object reaches the pills density and every other
// card-only affordance.
//
// fetchListProjection (ADR-0046, goal 0244 S1b) is the host's own bound
// AtlasService.ObjectListProjection, handed down as a prop rather than
// this component importing AtlasService itself -- the exact same
// function reference the pre-relocation version called inline, just
// sourced from the host instead of a local import.
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
// fixed box did for a large table. Width follows the SAME rule (goal
// 0286): unsized, the box is the grid's own width from TABLE_WIDTH up
// to TABLE_MAX_WIDTH (tableWidthForColumns), so adding a column widens the table instead of
// scrolling the first columns out of sight; past the cap the grid
// scrolls horizontally with a visible scrollbar (ListGrid.module.css).
// mirrorVersion (goal 0232 S1's file-backed contract) is accepted but
// unused -- a table projects a Configure List, never a mirrored file
// (fileBacked: false in tools/tableTool.ts), so this Kind's own
// version counter never actually bumps.
export function AtlasTableObjectContent({ object, fetchListProjection }: { object: BoardObject; mirrorVersion: number; fetchListProjection?: FetchListProjection }) {
  const [columnCount, setColumnCount] = useState(0)
  const hasSize = !!object.Size
  const style: CSSProperties = hasSize
    ? { width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }
    : { width: tableWidthForColumns(columnCount), height: 'auto', maxHeight: TABLE_HEIGHT, display: 'flex', flexDirection: 'column' }
  // fetchListProjection is always supplied by the real host
  // (AtlasBoardObjectNode.tsx) -- undefined only in a hypothetical
  // Component constructed with no host at all, which no table test
  // does today; rendering nothing rather than a non-null assertion
  // keeps this Kind's own "recoverable, never throws" convention
  // (atlasNounRegistry.ts's own boardObjectContentFor doc comment).
  if (!fetchListProjection) return null
  return (
    <div style={style}>
      {/* titleRow (goal 0273): the object's own name above its grid --
          a board object carries no card title, so this is the only
          place a table on the board is named. */}
      <AtlasCardProjectionTable scopeID={object.ID} fetchProjection={fetchListProjection} onColumnCount={setColumnCount} titleRow={{ objectID: object.ID }} />
    </div>
  )
}
