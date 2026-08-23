import { AtlasCardProjectionTable } from './AtlasCardProjectionTable'
import type { UnitRenderProps } from './unitRegistry'

// The table-projection unit's compact face -- the board node's own
// body (AtlasTableCardNode.tsx keeps its direct import for now; this
// exists so the registry's Face slot is a real, loadable component
// rather than a declared-but-empty shape, proof for slices 2-4 that a
// unit's board-face half of the pair loads the same way its page half
// does).
export function AtlasUnitTableProjectionFace({ card }: UnitRenderProps) {
  return <AtlasCardProjectionTable cardID={card.ID} density={card.ProjectionDensity} />
}
