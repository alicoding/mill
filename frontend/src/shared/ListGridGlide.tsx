import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@primer/react'
import { DataEditor, GridCellKind, type EditableGridCell, type GridCell, type Item, type Theme } from '@glideapps/glide-data-grid'
import '@glideapps/glide-data-grid/dist/index.css'
import { ConfigureService } from './bindings'
import { RowStatus } from '../../bindings/github.com/alicoding/mill/internal/domain/list/models'
import type { GridColumn, GridRow } from './ListGrid'
import styles from './ListGrid.module.css'

// The adopted grid (ADR-0049, goal 0287 slice 0): Glide Data Grid as
// the table's AUTHORING plane behind the same props ListGrid takes,
// so AtlasCardProjectionTable picks an implementation and nothing
// above the seam changes. The content plane stays Mill's: a cell edit
// is one UpdateListRow, an added row one AddListRowAt -- the same
// calls the hand-rolled grid makes. Schema editing (add/rename/delete
// column) is NOT here yet; slice 1 composes the existing header
// popover onto the grid's header events. Off by default behind the
// table extension's "New grid (experimental)" setting.

// Primer tokens -> the grid's own theme, read once per mount so light
// and dark both follow the app (the library themes by object, not by
// CSS variables).
function themeFromTokens(el: HTMLElement | null): Partial<Theme> {
  const css = el ? getComputedStyle(el) : null
  const v = (name: string, fallback: string) => css?.getPropertyValue(name).trim() || fallback
  return {
    accentColor: v('--bgColor-accent-emphasis', '#0969da'),
    accentLight: v('--bgColor-accent-muted', '#ddf4ff'),
    textDark: v('--fgColor-default', '#1f2328'),
    textMedium: v('--fgColor-muted', '#59636e'),
    textLight: v('--fgColor-disabled', '#8c959f'),
    textHeader: v('--fgColor-muted', '#59636e'),
    bgCell: v('--bgColor-default', '#ffffff'),
    bgCellMedium: v('--bgColor-muted', '#f6f8fa'),
    bgHeader: v('--bgColor-muted', '#f6f8fa'),
    bgHeaderHasFocus: v('--bgColor-accent-muted', '#ddf4ff'),
    bgHeaderHovered: v('--bgColor-neutral-muted', '#eaeef2'),
    borderColor: v('--borderColor-default', '#d1d9e0'),
    fontFamily: v('--fontStack-sansSerif', 'system-ui, sans-serif'),
    baseFontStyle: '12px',
    headerFontStyle: '600 11px',
  }
}

export function ListGridGlide({ listID, columns, rows }: { listID: string; columns: GridColumn[]; rows: GridRow[]; density?: string; schemaEditing?: boolean }) {
  const { t } = useTranslation('common')
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  const [error, setError] = useState('')
  const theme = useMemo(() => themeFromTokens(host), [host])

  const gridColumns = useMemo(() => columns.map((c) => ({ id: c.Key, title: c.Label || c.Key, width: 160 })), [columns])

  const getCellContent = useCallback((cell: Item): GridCell => {
    const [col, row] = cell
    const column = columns[col]
    const value = rows[row]?.Values?.[column?.Key ?? ''] ?? ''
    if (column?.Type === 'number') {
      const n = value === '' ? undefined : Number(value)
      return { kind: GridCellKind.Number, data: Number.isFinite(n) ? n : undefined, displayData: value, allowOverlay: true }
    }
    if (column?.Type === 'boolean') {
      return { kind: GridCellKind.Boolean, data: value === 'true', allowOverlay: false }
    }
    return { kind: GridCellKind.Text, data: value, displayData: value, allowOverlay: true }
  }, [columns, rows])

  const onCellEdited = useCallback((cell: Item, newValue: EditableGridCell) => {
    const [col, rowIdx] = cell
    const column = columns[col]
    const row = rows[rowIdx]
    if (!column || !row) return
    let next = ''
    if (newValue.kind === GridCellKind.Text) next = newValue.data
    else if (newValue.kind === GridCellKind.Number) next = newValue.data === undefined ? '' : String(newValue.data)
    else if (newValue.kind === GridCellKind.Boolean) next = newValue.data ? 'true' : 'false'
    const values: Record<string, string> = {}
    for (const [k, v] of Object.entries(row.Values ?? {})) if (v !== undefined) values[k] = v
    values[column.Key] = next
    ConfigureService.UpdateListRow(listID, row.ID, values, (row.Status || 'active') as RowStatus)
      .then(() => setError(''))
      .catch((err) => setError(String(err)))
  }, [columns, rows, listID])

  const addRow = () => {
    ConfigureService.AddListRowAt(listID, {}, rows.length).then(() => setError('')).catch((err) => setError(String(err)))
  }

  return (
    <div ref={setHost} className={styles.gridRoot} data-testid="atlas-projection-glide" data-columns={columns.length} data-rows={rows.length}>
      <div className={`${styles.scroll} nowheel nodrag`} style={{ minHeight: 120 }}>
        {columns.length === 0 ? (
          <p className={styles.empty} data-testid="atlas-projection-empty">{t('listGrid.noColumns')}</p>
        ) : (
          <DataEditor
            columns={gridColumns}
            rows={rows.length}
            getCellContent={getCellContent}
            onCellEdited={onCellEdited}
            theme={theme}
            width="100%"
            height={Math.min(320, 36 + rows.length * 28 + 4)}
            rowMarkers="number"
            smoothScrollX
            smoothScrollY
            getCellsForSelection
          />
        )}
      </div>
      <div className={styles.actionsRow}>
        <Button size="small" variant="invisible" data-testid="atlas-projection-add-row" onClick={addRow}>{t('listGrid.addRow')}</Button>
      </div>
      {error && <p className={styles.errorLine} data-testid="atlas-projection-error">{error}</p>}
    </div>
  )
}
