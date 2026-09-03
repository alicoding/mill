import { useCallback, useMemo } from 'react'
import type { DataEditorProps, EditListItem, EditableGridCell, GridCell, GridColumn as GlideColumn, GridSelection, Item, Rectangle, Theme } from '@glideapps/glide-data-grid'
import type { GridColumn, GridRow } from './ListGrid'
import type { useListSchemaEdits } from './useListSchemaEdits'
import { cellForColumn, valueFromEdited } from './listGridGlideCells'
import { ColumnMenu, RenameOverlay, RowMenu, type Anchor } from './ListGridGlideMenus'
import { GLIDE_DEFAULT_COLUMN_WIDTH, type GridPalette } from './listGridGlideTheme'
import { optionColor } from './projectionColors'

// ListGridGlide's two halves that are not the grid mount itself
// (split at the kit's complexity gate): the cell-edit callbacks the
// grid calls, and the schema / row overlays composed on top of it.

type Edits = ReturnType<typeof useListSchemaEdits>

export type GlideMenuState = { kind: 'column'; col: number; at: Anchor } | { kind: 'row'; row: number; at: Anchor } | null

// The grid's column descriptors: per-device widths, the menu icon
// only while schema editing is on, a muted header for a deprecated
// column.
export function useGlideColumns(columns: GridColumn[], widths: Record<string, number>, schemaEditing: boolean, palette: GridPalette): GlideColumn[] {
  return useMemo(() => columns.map((c) => ({
    id: c.Key,
    title: c.Label || c.Key,
    width: widths[c.Key] ?? GLIDE_DEFAULT_COLUMN_WIDTH,
    hasMenu: schemaEditing,
    themeOverride: c.Deprecated ? { textHeader: palette.theme.textLight } : undefined,
  })), [columns, widths, schemaEditing, palette])
}

// The pills density tints each row by its FIRST options column's
// value color (the status-board reading: a row IS its state).
export function useRowTint(density: string | undefined, columns: GridColumn[], rows: GridRow[], palette: GridPalette) {
  return useCallback((row: number): Partial<Theme> | undefined => {
    if (density !== 'pills') return undefined
    const statusCol = columns.find((c) => (c.Options?.length ?? 0) > 0)
    if (!statusCol) return undefined
    const color = optionColor(statusCol.Options, statusCol.OptionColors, rows[row]?.Values?.[statusCol.Key] ?? '')
    return color ? { bgCell: palette.pills[color].bg } : undefined
  }, [density, columns, rows, palette])
}

// The schema-editing half of the grid's props: header menu, header
// and row context menus, column reorder, and the trailing add-row --
// none of it when schema editing is off (a read-only mount).
export function schemaEditorProps(on: boolean, ctx: {
  edits: Edits
  rows: GridRow[]
  toAnchor: (bounds: Rectangle) => Anchor
  setMenu: (m: GlideMenuState) => void
  addRowHint: string
}): Partial<DataEditorProps> {
  if (!on) return {}
  const { edits, rows, toAnchor, setMenu, addRowHint } = ctx
  return {
    onColumnMoved: (from, to) => edits.moveColumn(from, to),
    onHeaderMenuClick: (col, bounds) => setMenu({ kind: 'column', col, at: toAnchor(bounds) }),
    onHeaderContextMenu: (col, e) => { e.preventDefault(); setMenu({ kind: 'column', col, at: toAnchor(e.bounds) }) },
    onCellContextMenu: (cell, e) => { e.preventDefault(); setMenu({ kind: 'row', row: cell[1], at: toAnchor(e.bounds) }) },
    trailingRowOptions: { hint: addRowHint, sticky: false, tint: true },
    onRowAppended: () => { edits.insertRowAt(rows.length) },
  }
}

export function useGlideCellEdits(columns: GridColumn[], rows: GridRow[], edits: Edits) {
  const getCellContent = useCallback((cell: Item): GridCell => {
    const [col, row] = cell
    return cellForColumn(columns[col], rows[row])
  }, [columns, rows])

  const onCellEdited = useCallback((cell: Item, newValue: EditableGridCell) => {
    const [col, rowIdx] = cell
    const column = columns[col]
    const row = rows[rowIdx]
    if (!column || !row) return
    void edits.commitCell(row, column.Key, valueFromEdited(newValue))
  }, [columns, rows, edits])

  // Paste, fill, and Delete arrive as one batch: one write per row.
  const onCellsEdited = useCallback((items: readonly EditListItem[]) => {
    const byRow = new Map<number, Record<string, string>>()
    for (const { location: [col, rowIdx], value } of items) {
      const column = columns[col]
      if (!column || !rows[rowIdx]) continue
      const patch = byRow.get(rowIdx) ?? {}
      patch[column.Key] = valueFromEdited(value)
      byRow.set(rowIdx, patch)
    }
    byRow.forEach((patch, rowIdx) => { void edits.updateRowValues(rows[rowIdx], patch) })
    return true
  }, [columns, rows, edits])

  // Delete clears the selection ourselves (the grid never mutates
  // data it does not own); returning false stops its own attempt.
  const onDelete = useCallback((selection: GridSelection) => {
    const range = selection.current?.range
    if (!range) return false
    const items: EditListItem[] = []
    for (let r = range.y; r < range.y + range.height; r++) {
      for (let c = range.x; c < range.x + range.width; c++) {
        const column = columns[c]
        if (!column) continue
        const empty = cellForColumn({ ...column, Options: null, OptionColors: null, Type: 'text' }, undefined)
        items.push({ location: [c, r], value: { ...empty, kind: empty.kind } as EditableGridCell })
      }
    }
    onCellsEdited(items)
    return false
  }, [columns, onCellsEdited])

  return { getCellContent, onCellEdited, onCellsEdited, onDelete }
}

export function GlideOverlays({ columns, rows, edits, menu, renaming, onCloseMenu, onRename, onInsertColumn, onCloseRename }: {
  columns: GridColumn[]
  rows: GridRow[]
  edits: Edits
  menu: GlideMenuState
  renaming: { key: string; at: Anchor } | null
  onCloseMenu: () => void
  onRename: (col: number) => void
  onInsertColumn: (index: number) => void
  onCloseRename: () => void
}) {
  return (
    <>
      {menu?.kind === 'column' && columns[menu.col] && (
        <ColumnMenu
          column={columns[menu.col]}
          field={edits.fieldFor(columns[menu.col])}
          at={menu.at}
          onClose={onCloseMenu}
          onRename={() => onRename(menu.col)}
          onInsert={(side) => onInsertColumn(side === 'left' ? menu.col : menu.col + 1)}
          onChange={edits.changeColumn}
          onRemove={() => { onCloseMenu(); edits.removeColumn(columns[menu.col].Key) }}
        />
      )}
      {menu?.kind === 'row' && rows[menu.row] && (
        <RowMenu
          row={rows[menu.row]}
          at={menu.at}
          onClose={onCloseMenu}
          onInsertBelow={() => { onCloseMenu(); edits.insertRowAt(menu.row + 1) }}
          onStatus={(status) => { onCloseMenu(); edits.setRowStatus(rows[menu.row], status) }}
          onDelete={() => { onCloseMenu(); edits.deleteRow(rows[menu.row].ID) }}
        />
      )}
      {renaming && (
        <RenameOverlay
          at={renaming.at}
          initial={columns.find((c) => c.Key === renaming.key)?.Label ?? ''}
          onCommit={(label) => { onCloseRename(); edits.renameColumn(renaming.key, label) }}
          onCancel={onCloseRename}
        />
      )}
    </>
  )
}
