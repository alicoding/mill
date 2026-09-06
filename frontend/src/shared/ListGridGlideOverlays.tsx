import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { IconButton } from '@primer/react'
import { PlusIcon } from '@primer/octicons-react'
import type { DataEditorProps, EditListItem, EditableGridCell, FillPatternEventArgs, GridCell, GridColumn as GlideColumn, Item, Rectangle, Theme } from '@glideapps/glide-data-grid'
import type { GridColumn, GridRow } from './listGridTypes'
import type { useListSchemaEdits } from './useListSchemaEdits'
import { cellForColumn } from './listGridGlideCells'
import { ColumnMenu, RenameOverlay, RowMenu, type Anchor } from './ListGridGlideMenus'
import { GLIDE_DEFAULT_COLUMN_WIDTH, type GridPalette } from './listGridGlideTheme'
import { fillSeries, type GridColumnFilter, type GridColumnFilters, type GridColumnSort, type GridSortDirection } from './listStandard'
import { optionColor } from './projectionColors'
import { editsByRow, pasteOverflowPatches } from './listGridGlideEdits'
import { runCommand } from './commands'
import { copy } from './copy'
import styles from './ListGrid.module.css'

// ListGridGlide's two halves that are not the grid mount itself
// (split at the kit's complexity gate): the cell-edit callbacks the
// grid calls, and the schema / row overlays composed on top of it.

type Edits = ReturnType<typeof useListSchemaEdits>

// What a paste overflowing the last row may do here: append the extra
// rows, or drop them and say so.
export interface PasteOptions {
  canAppendRows: boolean
  onRowsDropped: (count: number) => void
}

export type GlideMenuState = { kind: 'column'; col: number; at: Anchor } | { kind: 'row'; row: number; at: Anchor } | null

// The grid's column descriptors: per-device widths, the menu icon on
// every header (sorting and filtering live there and are reachable
// from a read-only mount too), a muted header for a deprecated column.
export function useGlideColumns(columns: GridColumn[], widths: Record<string, number>, sort: GridColumnSort | null, palette: GridPalette): GlideColumn[] {
  return useMemo(() => columns.map((c) => ({
    id: c.Key,
    // The sorted column carries its direction in its own header, the
    // spreadsheet convention -- the grid paints headers on a canvas, so
    // the arrow is part of the title rather than a sibling element.
    title: `${c.Label || c.Key}${sort?.key === c.Key ? (sort.direction === 'asc' ? ' \u2191' : ' \u2193') : ''}`,
    width: widths[c.Key] ?? GLIDE_DEFAULT_COLUMN_WIDTH,
    hasMenu: true,
    themeOverride: c.Deprecated ? { textHeader: palette.theme.textLight } : undefined,
  })), [columns, widths, sort, palette])
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

// The menus composed on the grid's own header and cell events. Sorting
// and filtering are reachable from every mount, so the header menu is
// NOT gated on schema editing (the menu itself hides the schema items);
// column reorder and the trailing add-row are.
export function menuProps(ctx: {
  toAnchor: (bounds: Rectangle) => Anchor
  setMenu: (m: GlideMenuState) => void
}): Partial<DataEditorProps> {
  const { toAnchor, setMenu } = ctx
  return {
    onHeaderMenuClick: (col, bounds) => setMenu({ kind: 'column', col, at: toAnchor(bounds) }),
    onHeaderContextMenu: (col, e) => { e.preventDefault(); setMenu({ kind: 'column', col, at: toAnchor(e.bounds) }) },
    onCellContextMenu: (cell, e) => { e.preventDefault(); setMenu({ kind: 'row', row: cell[1], at: toAnchor(e.bounds) }) },
  }
}

// The grid's own "add a column" affordance (goal 0349 S4 Part B): a
// small button, never the toolbar underneath the grid the library's
// own placements replace. Shared by the header-end rail (AddColumnRail,
// once the grid is mounted) and the empty state (before any column
// exists, so nothing is mounted yet to carry a rail). A real component
// (capitalized, per React's own convention) so it can resolve its own
// label -- schemaEditorProps below is a plain builder function, not a
// component, and cannot call a hook itself.
export function AddColumnButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation('common')
  return (
    <IconButton
      aria-label={t('listGrid.addColumnAriaLabel')}
      icon={PlusIcon}
      variant="invisible"
      size="small"
      onClick={onClick}
      data-testid="list-grid-add-column"
    />
  )
}

// The header-end rail (DataEditor's own `rightElement`, the library's
// documented "make a big add button" use of it): a real DOM node
// outside the canvas, sized to exactly headerHeight so it reads as one
// more header cell rather than a painted grid column -- the canvas
// itself never draws past the last real column.
export function AddColumnRail({ headerHeight, onClick }: { headerHeight: number; onClick: () => void }) {
  return (
    <div className={styles.addColumnRail} style={{ width: headerHeight }}>
      <div className={styles.addColumnHeaderCell} style={{ height: headerHeight }}>
        <AddColumnButton onClick={onClick} />
      </div>
    </div>
  )
}

// The schema-editing half of the grid's props: column reorder and the
// trailing add-row -- neither when schema editing is off (a read-only
// mount). Stateless only: the header-end add-column rail is set
// directly as a JSX prop on <DataEditor> in ListGridGlide.tsx instead
// of flowing through here -- it closes over the mount's own
// insertColumn, which writes a ref (pendingRenameKey) on resolve, and
// a plain function call during render (this one) must never receive an
// argument built from a ref-touching closure; only a JSX prop value
// may carry one.
export function schemaEditorProps(on: boolean, ctx: {
  listID: string
  edits: Edits
}): Partial<DataEditorProps> {
  if (!on) return {}
  const { listID, edits } = ctx
  return {
    onColumnMoved: (from, to) => edits.moveColumn(from, to),
    trailingRowOptions: { hint: copy('listGrid.addRowHint'), sticky: true, tint: true },
    // Stateless: appending a row needs no rename-style follow-up, so
    // it runs the registry command directly rather than reaching into
    // any specific mount -- listGrid.addRow always appends at the
    // list's own end regardless of which mount's trailing row was
    // clicked.
    onRowAppended: () => { void runCommand('listGrid.addRow', { kind: 'listGrid', listID, rowIDs: [] }) },
  }
}

// One column's stored string at a grid location, and the editable cell
// that writes a new one -- both read through cellForColumn, so paste
// and fill land the same cell kinds the grid renders.
function valueAt(columns: GridColumn[], rows: GridRow[], col: number, row: number): string {
  const key = columns[col]?.Key
  return key === undefined ? '' : rows[row]?.Values?.[key] ?? ''
}

function editCell(column: GridColumn, value: string): EditableGridCell {
  return cellForColumn(column, { ID: '', Status: '', Values: { [column.Key]: value } }) as EditableGridCell
}

// A fill drag's geometry: which lanes the pattern repeats along, how
// many cells each lane grows by, and where those cells are. Null when
// the drag is not a straight extension of the source downward or
// rightward -- a fill upward or leftward always tiles.
interface FillAxis {
  lanes: number
  grown: number
  sourceCells: (lane: number) => { col: number; row: number }[]
  target: (lane: number, step: number) => { col: number; row: number }
}

function fillAxis(source: Rectangle, destination: Rectangle): FillAxis | null {
  if (destination.x !== source.x || destination.y !== source.y) return null
  if (destination.width === source.width && destination.height > source.height) {
    return {
      lanes: source.width,
      grown: destination.height - source.height,
      sourceCells: (lane) => Array.from({ length: source.height }, (_, i) => ({ col: source.x + lane, row: source.y + i })),
      target: (lane, step) => ({ col: source.x + lane, row: source.y + source.height + step }),
    }
  }
  if (destination.height === source.height && destination.width > source.width) {
    return {
      lanes: source.height,
      grown: destination.width - source.width,
      sourceCells: (lane) => Array.from({ length: source.width }, (_, i) => ({ col: source.x + i, row: source.y + lane })),
      target: (lane, step) => ({ col: source.x + source.width + step, row: source.y + lane }),
    }
  }
  return null
}

// One lane's continuation, or null when its cells do not all share one
// column type or do not form a progression.
function laneSeries(cells: { col: number; row: number }[], grown: number, columns: GridColumn[], rows: GridRow[]): string[] | null {
  const types = new Set(cells.map((c) => columns[c.col]?.Type || 'text'))
  if (types.size !== 1) return null
  return fillSeries(cells.map((c) => valueAt(columns, rows, c.col, c.row)), grown, [...types][0])
}

// The edits a fill drag makes when its source is an arithmetic
// progression, or null when it is not -- the caller then lets the grid
// tile the pattern, which is that library's own fill behaviour.
function seriesEdits(source: Rectangle, destination: Rectangle, columns: GridColumn[], rows: GridRow[]): EditListItem[] | null {
  const axis = fillAxis(source, destination)
  if (axis === null) return null
  const items: EditListItem[] = []
  for (let lane = 0; lane < axis.lanes; lane++) {
    const series = laneSeries(axis.sourceCells(lane), axis.grown, columns, rows)
    if (series === null) return null
    for (const [step, value] of series.entries()) {
      const { col, row } = axis.target(lane, step)
      const column = columns[col]
      if (!column || !rows[row]) return null
      items.push({ location: [col, row], value: editCell(column, value) })
    }
  }
  return items
}

// The grid's data doors: read a cell, write a batch, take a paste, take
// a fill. Delete is deliberately absent -- the library's own delete
// already walks the primary range, every secondary range, selected rows
// and selected columns through onCellsEdited, and clears a custom cell
// via its renderer's deletedValue (goal 0349 S4 replaced Mill's
// partial re-implementation with it).
export function useGlideCellEdits(columns: GridColumn[], rows: GridRow[], edits: Edits, paste: PasteOptions) {
  const getCellContent = useCallback((cell: Item): GridCell => {
    const [col, row] = cell
    return cellForColumn(columns[col], rows[row])
  }, [columns, rows])

  // Paste, fill, and Delete arrive as one batch: one write per row.
  const onCellsEdited = useCallback((items: readonly EditListItem[]) => {
    const byRow = editsByRow(columns, rows, items)
    byRow.forEach((patch, rowIdx) => { void edits.updateRowValues(rows[rowIdx], patch) })
    return true
  }, [columns, rows, edits])

  // The library applies the part of a paste that fits and stops at the
  // last row. Rows past the end are the content plane's to create, so
  // they are appended here with their values already set; returning
  // true then lets the library write the in-range part itself.
  const onPaste = useCallback((target: Item, values: readonly (readonly string[])[]) => {
    const [targetCol, targetRow] = target
    const overflow = pasteOverflowPatches(columns, rows, targetCol, targetRow, values)
    if (overflow.length > 0) {
      if (!paste.canAppendRows) {
        paste.onRowsDropped(overflow.length)
        return true
      }
      void edits.appendRowsWithValues(overflow)
    }
    return true
  }, [columns, rows, edits, paste])

  const onFillPattern = useCallback((event: FillPatternEventArgs) => {
    const items = seriesEdits(event.patternSource, event.fillDestination, columns, rows)
    if (items === null) return
    event.preventDefault()
    onCellsEdited(items)
  }, [columns, rows, onCellsEdited])

  return { getCellContent, onCellsEdited, onPaste, onFillPattern }
}

export function GlideOverlays({ columns, rows, edits, menu, renaming, schemaEditing, sort, filters, storedIndexOf, onCloseMenu, onRename, onInsertColumn, onCloseRename, onSort, onFilter }: {
  columns: GridColumn[]
  // The rows as SHOWN: a menu's row index is a position in the sorted,
  // filtered view.
  rows: GridRow[]
  edits: Edits
  menu: GlideMenuState
  renaming: { key: string; at: Anchor } | null
  schemaEditing: boolean
  sort: GridColumnSort | null
  filters: GridColumnFilters
  // A showing row's index in the STORED list -- where an insert
  // actually lands.
  storedIndexOf: (viewRow: number) => number
  onCloseMenu: () => void
  onRename: (col: number) => void
  onInsertColumn: (index: number) => void
  onCloseRename: () => void
  onSort: (key: string, direction: GridSortDirection | undefined) => void
  onFilter: (key: string, next: GridColumnFilter) => void
}) {
  return (
    <>
      {menu?.kind === 'column' && columns[menu.col] && (
        <ColumnMenu
          column={columns[menu.col]}
          field={edits.fieldFor(columns[menu.col])}
          at={menu.at}
          schemaEditing={schemaEditing}
          sort={sort?.key === columns[menu.col].Key ? sort.direction : undefined}
          filter={filters[columns[menu.col].Key] ?? {}}
          onClose={onCloseMenu}
          onRename={() => onRename(menu.col)}
          onInsert={(side) => onInsertColumn(side === 'left' ? menu.col : menu.col + 1)}
          onChange={edits.changeColumn}
          onRemove={() => { onCloseMenu(); edits.removeColumn(columns[menu.col].Key) }}
          onSort={(direction) => onSort(columns[menu.col].Key, direction)}
          onFilter={(next) => onFilter(columns[menu.col].Key, next)}
        />
      )}
      {menu?.kind === 'row' && rows[menu.row] && (
        <RowMenu
          row={rows[menu.row]}
          at={menu.at}
          onClose={onCloseMenu}
          onInsertBelow={() => { onCloseMenu(); edits.insertRowAt(storedIndexOf(menu.row) + 1) }}
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
