import { TABLE_PROJECTION_UNITS } from './atlasUnitTableProjection'
import { MIRROR_UNITS } from './atlasUnitMirror'
import { MERMAID_UNITS } from './atlasUnitMermaid'
import { DRAWIO_UNITS } from './atlasUnitDrawio'
import { ICON_FALLBACK_UNITS } from './atlasUnitIconFallback'
import { resolveUnit as resolveUnitFrom } from './unitRegistry'
import type { DetectableCard, UnitRenderer } from './unitRegistry'

// The board-unit registry's assembly point (ADR-0043, goal 0133) --
// mirrors shared/commands.ts's own shape: each unit family declares
// its own array (atlasUnitTableProjection.ts, atlasUnitMirror.ts,
// atlasUnitMermaid.ts, atlasUnitIconFallback.ts), this file
// concatenates them into ONE ordered list. Order IS resolution
// priority (ADR-0043 §1): a projection ref beats an extension beats a
// bare Source, so table-projection is assembled first, then drawio
// (its "drawio-svg" entry matches the full ".drawio.svg" suffix and
// MUST be checked before mirror-image's wider bare ".svg" match, or
// mirror-image would claim those cards first), then the remaining
// extension-matched mirror and mermaid units (mutually exclusive
// extension sets among themselves, so their relative order doesn't
// matter), and the icon-card fallback (the widest detect() of any
// unit) last.
export const UNIT_REGISTRY: UnitRenderer[] = [
  ...TABLE_PROJECTION_UNITS,
  ...DRAWIO_UNITS,
  ...MIRROR_UNITS,
  ...MERMAID_UNITS,
  ...ICON_FALLBACK_UNITS,
]

export function resolveUnit(card: DetectableCard): UnitRenderer | null {
  return resolveUnitFrom(UNIT_REGISTRY, card)
}
