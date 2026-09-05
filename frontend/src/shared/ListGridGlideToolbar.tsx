import { useTranslation } from 'react-i18next'
import { Button } from '@primer/react'
import type { GridSelection } from '@glideapps/glide-data-grid'
import { runCommand } from './commands'
import type { GridColumn, GridRow } from './listGridTypes'
import { activeFilterCount, type GridColumnFilters, type GridColumnSort } from './listStandard'
import styles from './ListGrid.module.css'

// The grid's action row (goal 0349 S4): the two always-present author
// actions, plus whatever the current selection makes possible. Every
// button runs a registry command with the selection stated as its
// context -- nothing acts inline, and a command with nothing to act on
// is simply absent rather than dimmed.

// The tab/newline text the selected rows copy as: every showing column,
// in the order the grid shows them.
export function rowsAsText(rows: GridRow[], columns: GridColumn[]): string {
  return rows.map((row) => columns.map((c) => row.Values?.[c.Key] ?? '').join('\t')).join('\n')
}

export function ListGridGlideToolbar({ listID, columns, rows, selection, schemaEditing, sort, filters, onAddRow, onAddColumn, onClearNarrowing }: {
  listID: string
  columns: GridColumn[]
  // The rows as SHOWN -- a selection index is a position in the sorted,
  // filtered view, never in the stored list.
  rows: GridRow[]
  selection: GridSelection
  schemaEditing: boolean
  sort: GridColumnSort | null
  filters: GridColumnFilters
  onAddRow: () => void
  onAddColumn: () => void
  onClearNarrowing: () => void
}) {
  const { t } = useTranslation('common')
  const selectedRows = selection.rows.toArray().map((i) => rows[i]).filter((r): r is GridRow => r !== undefined)
  const selectedColumn = columns[selection.columns.toArray()[0] ?? -1]
  const rowIDs = selectedRows.map((r) => r.ID)
  const ctx = { kind: 'listGrid' as const, listID, rowIDs, columnKey: selectedColumn?.Key, text: rowsAsText(selectedRows, columns) }
  const narrowed = activeFilterCount(filters) + (sort ? 1 : 0)

  return (
    <div className={styles.actionsRow}>
      {columns.length > 0 && (
        <Button size="small" variant="invisible" data-testid="atlas-projection-add-row" onClick={onAddRow}>{t('listGrid.addRow')}</Button>
      )}
      {schemaEditing && (
        <Button size="small" variant="invisible" data-testid="atlas-projection-add-column" onClick={onAddColumn}>{t('listGrid.addColumn')}</Button>
      )}
      {rowIDs.length > 0 && (
        <>
          <Button size="small" variant="invisible" data-testid="list-grid-copy-rows" onClick={() => void runCommand('listGrid.copyRows', ctx)}>
            {t('listGrid.copyRows', { count: rowIDs.length })}
          </Button>
          <Button size="small" variant="danger" data-testid="list-grid-delete-rows" onClick={() => void runCommand('listGrid.deleteRows', ctx)}>
            {t('listGrid.deleteRows', { count: rowIDs.length })}
          </Button>
        </>
      )}
      {schemaEditing && selectedColumn && (
        <Button size="small" variant="danger" data-testid="list-grid-delete-column" onClick={() => void runCommand('listGrid.deleteColumn', ctx)}>
          {t('listGrid.deleteColumnAction', { column: selectedColumn.Label || selectedColumn.Key })}
        </Button>
      )}
      {narrowed > 0 && (
        <Button size="small" variant="invisible" data-testid="list-grid-clear-narrowing" onClick={onClearNarrowing}>{t('listGrid.clearNarrowing')}</Button>
      )}
    </div>
  )
}
