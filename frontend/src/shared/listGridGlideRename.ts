import type { Rectangle } from '@glideapps/glide-data-grid'
import type { GridColumn } from './listGridTypes'

// A fresh column opens its rename once the grid's own
// onVisibleRegionChanged reports the column inside its visible range
// -- the grid's own readiness signal, never a bounds probe (getBounds
// can report a zero-width rectangle before the grid's first layout
// pass, so its validity is not what this checks). `visibleRange` is
// the range from the MOST RECENT such report, which may be null (none
// reported yet) or stale relative to `pendingKey` in either direction
// -- the insert's own round trip and the grid's local resize settle
// independently, so a caller re-evaluates this on every region report
// AND on every pendingKey change, never on a timer.
export function resolvePendingRename(
  columns: GridColumn[],
  pendingKey: string | null,
  visibleRange: Rectangle | null,
): number | null {
  if (pendingKey === null || visibleRange === null) return null
  const col = columns.findIndex((c) => c.Key === pendingKey)
  if (col === -1) return null
  return col >= visibleRange.x && col < visibleRange.x + visibleRange.width ? col : null
}
