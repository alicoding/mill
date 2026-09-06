import type { EditListItem } from '@glideapps/glide-data-grid'
import type { GridColumn, GridRow } from './listGridTypes'
import { valueFromEdited } from './listGridGlideCells'

// The grid's bulk-edit shapes (goal 0349 S4), pulled out of
// ListGridGlideOverlays.tsx into a leaf module: pure functions with no
// Glide CSS or Primer import in their chain, so a unit test can drive
// them directly without mounting anything.

// Collapses one onCellsEdited batch -- a single typed commit, a
// paste, a fill, or Delete all arrive here as ONE batch -- into one
// values-patch per row: the shape every commit becomes ONE row-door
// write (useListSchemaEdits' updateRowValues). An edit whose row or
// column no longer exists in the current view is dropped rather than
// thrown on: the batch can outlive a narrowing filter or a removed
// column mid-flight.
export function editsByRow(columns: GridColumn[], rows: GridRow[], items: readonly EditListItem[]): Map<number, Record<string, string>> {
  const byRow = new Map<number, Record<string, string>>()
  for (const { location: [col, rowIdx], value } of items) {
    const column = columns[col]
    if (!column || !rows[rowIdx]) continue
    const patch = byRow.get(rowIdx) ?? {}
    patch[column.Key] = valueFromEdited(value)
    byRow.set(rowIdx, patch)
  }
  return byRow
}

// A paste's rows past the stored list's end, each mapped from its
// pasted TSV cells to a column-keyed values patch -- appendRowsWithValues'
// own input shape (the Excel behaviour: a paste taller than the list
// appends rows). Empty when the whole paste fits inside the stored
// rows. A column past the LAST one is dropped, never grows the schema
// -- Glide's own paste clips there, and Mill's paste never creates a
// column from pasted text.
export function pasteOverflowPatches(columns: GridColumn[], rows: GridRow[], targetCol: number, targetRow: number, values: readonly (readonly string[])[]): Record<string, string>[] {
  const overflow = values.slice(Math.max(0, rows.length - targetRow))
  return overflow.map((line) => {
    const patch: Record<string, string> = {}
    for (const [i, cell] of line.entries()) {
      const column = columns[targetCol + i]
      if (column) patch[column.Key] = cell
    }
    return patch
  })
}
