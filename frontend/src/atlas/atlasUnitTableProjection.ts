import { cachedLoader } from './unitRegistry'
import type { UnitRenderer } from './unitRegistry'

// The List -> table projection unit (goal 0105): highest resolution
// priority (ADR-0043 §1 -- "a projection ref beats an extension"),
// detected by ProjectionListID alone, independent of any MirrorPath.
// Carries no file-tag chip -- the board face shows its own
// density-toggle chip instead (AtlasTableCardNode.tsx, untouched).
export const TABLE_PROJECTION_UNITS: UnitRenderer[] = [
  {
    id: 'table-projection',
    detect: (card) => Boolean(card.ProjectionListID),
    tag: () => null,
    render: {
      Page: cachedLoader(() => import('./AtlasUnitTableProjectionPage').then((m) => m.AtlasUnitTableProjectionPage)),
      Face: cachedLoader(() => import('./AtlasUnitTableProjectionFace').then((m) => m.AtlasUnitTableProjectionFace)),
    },
    exporters: [],
  },
]
