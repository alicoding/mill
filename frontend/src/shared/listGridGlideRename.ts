import type { Rectangle } from '@glideapps/glide-data-grid'
import type { GridColumn } from './listGridTypes'

// A fresh column opens its rename once BOTH signals the grid reports
// independently have landed: `columns` includes the new key (the
// insert round-tripped) and `getColumnBounds` returns a rectangle for
// it (only true once the grid has painted a region since -- a column
// it has not yet measured reports a zero-width rectangle). Neither
// landing is assumed from the other; a caller re-evaluates this on
// every columns change and on every grid region report, never on a
// timer.
export function resolvePendingRename(
  columns: GridColumn[],
  pendingKey: string | null,
  getColumnBounds: (col: number) => Rectangle | undefined,
): { col: number; bounds: Rectangle } | null {
  if (pendingKey === null) return null
  const col = columns.findIndex((c) => c.Key === pendingKey)
  if (col === -1) return null
  const bounds = getColumnBounds(col)
  if (!bounds) return null
  return { col, bounds }
}
