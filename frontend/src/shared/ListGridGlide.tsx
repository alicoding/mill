import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Text } from '@primer/react'
import { CompactSelection, DataEditor, type DataEditorRef, type GridSelection, type Rectangle } from '@glideapps/glide-data-grid'
import '@glideapps/glide-data-grid/dist/index.css'
import type { GridColumn, GridRow } from './listGridTypes'
import { useListSchemaEdits } from './useListSchemaEdits'
import { optionsRenderer } from './listGridGlideCells'
import { GLIDE_DEFAULT_COLUMN_WIDTH, GLIDE_HEADER_HEIGHT, GLIDE_HEADER_HEIGHT_COMPACT, GLIDE_ROW_HEIGHT, GLIDE_ROW_HEIGHT_COMPACT, useGridPalette } from './listGridGlideTheme'
import { useDisplayDensity } from './density'
import { anchorFromBounds, type Anchor } from './ListGridGlideMenus'
import { GlideOverlays, menuProps, schemaEditorProps, useGlideCellEdits, useGlideColumns, useRowTint, type GlideMenuState } from './ListGridGlideOverlays'
import { ListGridGlideToolbar } from './ListGridGlideToolbar'
import { filterGridRows, nextSortDirection, sortGridRows, type GridColumnFilter, type GridColumnFilters, type GridColumnSort, type GridSortDirection } from './listStandard'
import styles from './ListGrid.module.css'

// The adopted grid (ADR-0049, goals 0287 / 0349 S4): Glide Data Grid as
// the table's AUTHORING plane behind the same props ListGrid takes.
// Every interaction on it is the library's own -- click selects, drag
// or shift-click extends the range, a second click / Enter / typing
// edits, Enter commits down, Tab commits right, Escape cancels, copy
// and paste move the range through the clipboard, the fill handle
// fills it, Delete clears it, the grid's own search opens on its own
// hotkey, headers resize and reorder by drag. The content plane stays
// Mill's: every commit -- typed, pasted, filled or cleared -- arrives
// as onCellsEdited and leaves as one UpdateListRow per row, through the
// same hook every mount uses (useListSchemaEdits). What the library
// leaves to the integrator by design is composed ON the grid rather
// than re-implemented inside it: the schema menus, the per-column sort
// and filter (listStandard.ts), the bulk actions
// (ListGridGlideToolbar.tsx), and the per-device column widths.

// Column widths are per-device UI state (the schema has no width),
// keyed by list. Column ORDER is not: a header drag rewrites the List's
// own column order (useListSchemaEdits' moveColumn), so it persists for
// every projection of that list, on every device.
const widthsKey = (listID: string) => `mill-list-column-widths:${listID}`
function readWidths(listID: string): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(widthsKey(listID)) ?? '{}') as Record<string, number>
  } catch {
    return {}
  }
}

const EMPTY_SELECTION: GridSelection = { columns: CompactSelection.empty(), rows: CompactSelection.empty(), current: undefined }

function narrowedKeys(filters: GridColumnFilters): string {
  return Object.keys(filters).filter((k) => (filters[k].contains ?? '') !== '' || (filters[k].min ?? '') !== '' || (filters[k].max ?? '') !== '').join(',')
}

// editorPortal: where the library mounts its overlay cell editor.
// 'body' (default) is its own body-level #portal, which keeps the
// editor out of any CSS-transformed ancestor (a board object scales
// with the canvas). 'host' mounts it inside this grid's own tree --
// required inside a focus-trapping dialog (the card page): a trap
// pulls focus back from anything outside its subtree, so a body-level
// editor never receives keystrokes and every commit is lost.
export function ListGridGlide({ listID, columns, rows, density, schemaEditing = true, editorPortal = 'body', onReleaseKeyboard }: { listID: string; columns: GridColumn[]; rows: GridRow[]; density?: string; schemaEditing?: boolean; editorPortal?: 'body' | 'host'; onReleaseKeyboard?: () => void }) {
  const { t } = useTranslation('common')
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  const gridRef = useRef<DataEditorRef>(null)
  const portalRef = useRef<HTMLDivElement>(null)
  const edits = useListSchemaEdits(listID, columns, rows)
  const palette = useGridPalette(host)
  const renderers = useMemo(() => [optionsRenderer(palette)], [palette])
  const [widths, setWidths] = useState<Record<string, number>>(() => readWidths(listID))
  const [menu, setMenu] = useState<GlideMenuState>(null)
  const [renaming, setRenaming] = useState<{ key: string; at: Anchor } | null>(null)
  const [sort, setSort] = useState<GridColumnSort | null>(null)
  const [filters, setFilters] = useState<GridColumnFilters>({})
  const [selection, setSelection] = useState<GridSelection>(EMPTY_SELECTION)
  const [droppedRows, setDroppedRows] = useState(0)
  const toAnchor = useCallback((bounds: Rectangle) => anchorFromBounds(host, bounds), [host])

  // What the grid SHOWS: the stored rows narrowed, then ordered. Every
  // index the grid reports -- a selection, a menu, an edit -- is a
  // position in this array, so it is the array every callback reads.
  const viewRows = useMemo(() => sortGridRows(filterGridRows(rows, columns, filters), columns, sort), [rows, columns, filters, sort])
  const storedIndexOf = useCallback((viewRow: number) => {
    const id = viewRows[viewRow]?.ID
    const index = rows.findIndex((r) => r.ID === id)
    return index === -1 ? rows.length : index
  }, [rows, viewRows])

  const gridColumns = useGlideColumns(columns, widths, sort, palette)
  const paste = useMemo(() => ({ canAppendRows: schemaEditing, onRowsDropped: setDroppedRows }), [schemaEditing])
  const cellEdits = useGlideCellEdits(columns, viewRows, edits, paste)
  const getRowThemeOverride = useRowTint(density, columns, viewRows, palette)

  const onColumnResize = useCallback((column: { id?: string }, newSize: number) => {
    setWidths((prev) => {
      const next = { ...prev, [String(column.id)]: newSize }
      try { localStorage.setItem(widthsKey(listID), JSON.stringify(next)) } catch { /* per-device convenience only */ }
      return next
    })
  }, [listID])

  // A header click cycles that column's sort: ascending, descending,
  // none. The library's own column selection runs on the same click
  // (its mousedown), which is what puts the column's bulk action in
  // reach -- both are the library's own behaviour, neither overridden.
  const cycleSort = useCallback((col: number) => {
    const key = columns[col]?.Key
    if (key === undefined) return
    setSort((prev) => {
      const direction = nextSortDirection(prev?.key === key ? prev.direction : undefined)
      return direction === undefined ? null : { key, direction }
    })
  }, [columns])

  const applySort = useCallback((key: string, direction: GridSortDirection | undefined) => {
    setSort(direction === undefined ? null : { key, direction })
  }, [])

  const applyFilter = useCallback((key: string, next: GridColumnFilter) => {
    setFilters((prev) => ({ ...prev, [key]: next }))
  }, [])

  // The header's rectangle comes from the grid's own layout; on a
  // first mount (an empty List's first column) it is not there for a
  // few frames yet, so the lookup retries briefly instead of giving up.
  const openRename = useCallback((col: number, at?: Anchor) => {
    const column = columns[col]
    if (!column) return
    setMenu(null)
    if (at) {
      setRenaming({ key: column.Key, at })
      return
    }
    let tries = 0
    const attempt = () => {
      const bounds = gridRef.current?.getBounds(col, -1)
      if (bounds && bounds.width > 0) {
        setRenaming({ key: column.Key, at: toAnchor(bounds) })
        return
      }
      if (++tries < 30) window.requestAnimationFrame(attempt)
    }
    attempt()
  }, [columns, toAnchor])

  // A fresh column goes straight into rename once its insert LANDED,
  // at the header the new column now occupies (the grid lays it out
  // on its next frame).
  const pendingRenameKey = useRef<string | null>(null)
  const insertColumn = (index: number) => {
    void edits.insertColumnAt(index).then((key) => { pendingRenameKey.current = key ?? null })
  }
  useEffect(() => {
    const col = columns.findIndex((c) => c.Key === pendingRenameKey.current)
    if (col === -1) return
    pendingRenameKey.current = null
    const id = window.setTimeout(() => openRename(col), 0)
    return () => window.clearTimeout(id)
  }, [columns, openRename])

  // Escape hands the keyboard BACK (goal 0273): with no overlay editor
  // open, Escape leaves the grid rather than staying inside it, so the
  // host (a board object) gets its keys back. A CAPTURE listener on
  // this host, not the React onKeyDown below: the library stops
  // propagation on every key it handles, so a bubble-phase handler
  // never sees Escape at all -- and taking the key here also keeps the
  // library from restoring focus into its own accessibility DOM behind
  // us. An open editor owns its own Escape (cancel the edit): it mounts
  // in the body-level #portal, or on a focus-trapping page in this
  // grid's own portal box, so its keys never reach this element.
  useEffect(() => {
    if (!host) return
    const onEscapeCapture = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const target = e.target instanceof Element ? e.target : null
      if (target?.closest('#portal') || (target && portalRef.current?.contains(target))) return
      e.stopPropagation()
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      onReleaseKeyboard?.()
    }
    host.addEventListener('keydown', onEscapeCapture, true)
    return () => host.removeEventListener('keydown', onEscapeCapture, true)
  }, [host, onReleaseKeyboard])

  // A paste that lands IN the grid is the grid's, never the surface
  // under it: on a board, the same event would otherwise ALSO land a
  // note from the clipboard. Claimed in the capture phase while focus
  // sits inside this grid, through the board's own "a more specific
  // paste surface marks the event handled" protocol
  // (atlas/useAtlasPaste.ts). preventDefault marks it without stopping
  // propagation, so the grid's own paste handler still runs.
  useEffect(() => {
    if (!host) return
    const claim = (e: ClipboardEvent) => {
      if (!host.contains(document.activeElement)) return
      e.preventDefault()
    }
    window.addEventListener('paste', claim, true)
    return () => window.removeEventListener('paste', claim, true)
  }, [host])

  // editorPortal 'host' (goal 0349 S4): the stable release resolves its
  // overlay editor's mount point as document.getElementById('portal')
  // and takes no override, so the adapter moves that one element INTO
  // this grid's own fixed, zero-size box while this mount lives, and
  // returns it to the body on unmount. The element's identity never
  // changes, so React's portal container stays valid across the move,
  // and the box is position:fixed at the viewport origin -- the exact
  // coordinate space the library positions its editor in.
  useEffect(() => {
    if (editorPortal !== 'host') return
    const portal = document.getElementById('portal')
    const box = portalRef.current
    if (!portal || !box) return
    const home = portal.parentElement
    box.append(portal)
    return () => { home?.append(portal) }
  }, [editorPortal])

  const compact = useDisplayDensity() === 'compact'
  const rowHeight = compact ? GLIDE_ROW_HEIGHT_COMPACT : GLIDE_ROW_HEIGHT
  const headerHeight = compact ? GLIDE_HEADER_HEIGHT_COMPACT : GLIDE_HEADER_HEIGHT
  const height = headerHeight + (viewRows.length + (schemaEditing ? 1 : 0)) * rowHeight + 2

  return (
    <div
      ref={setHost}
      className={styles.gridRoot}
      style={{ position: 'relative' }}
      data-testid="atlas-projection-glide"
      data-columns={columns.length}
      data-rows={viewRows.length}
      data-stored-rows={rows.length}
      data-sort={sort ? `${sort.key}:${sort.direction}` : ''}
      data-filtered={narrowedKeys(filters)}
      data-selected-rows={selection.rows.length}
      data-col-widths={columns.map((c) => widths[c.Key] ?? GLIDE_DEFAULT_COLUMN_WIDTH).join(',')}
      data-col-types={columns.map((c) => ((c.Options?.length ?? 0) > 0 ? 'options' : c.Type || 'text')).join(',')}
      data-col-keys={columns.map((c) => c.Key).join(',')}
      data-col-deprecated={columns.filter((c) => c.Deprecated).map((c) => c.Key).join(',')}
      // The canvas cannot follow a CSS variable, so the palette read is
      // published here: it is the only observable that the grid's own
      // colors track the applied scheme.
      data-cell-bg={palette.theme.bgCell}
      data-header-height={headerHeight}
      data-row-height={rowHeight}
      // Arrow keys and typing inside the grid belong to the grid --
      // never to the board's node keyboard handling (which would move
      // the object) nor the canvas's own shortcuts; a right-click is
      // the grid's header / row menu, never the object's own menu.
      // Escape is the one key handed back -- see the capture listener
      // above.
      onKeyDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div className={`${styles.scroll} nowheel nodrag nopan`} style={{ minHeight: 120, maxHeight: 420 }}>
        {columns.length === 0 ? (
          <p className={styles.empty} data-testid="atlas-projection-empty">{t('listGrid.noColumns')}</p>
        ) : (
          <DataEditor
            ref={gridRef}
            columns={gridColumns}
            rows={viewRows.length}
            {...cellEdits}
            getCellsForSelection
            customRenderers={renderers}
            theme={palette.theme}
            getRowThemeOverride={getRowThemeOverride}
            width="100%"
            height={Math.min(420, height)}
            rowHeight={rowHeight}
            headerHeight={headerHeight}
            // "both": a row's number, revealing its checkbox on hover
            // -- the marker column that makes a multi-row selection,
            // and the bulk actions it enables, reachable by mouse.
            rowMarkers="both"
            // A marker checkbox accumulates without a modifier -- the
            // checkbox convention, and the library's own prop for it.
            rowSelectionMode="multi"
            // The library's own multi-range selection: a drag makes a
            // rectangle, shift-click extends it, a modifier-click adds
            // another. Copy, clear and fill all act on it.
            rangeSelect="multi-rect"
            fillHandle
            gridSelection={selection}
            onGridSelectionChange={setSelection}
            onHeaderClicked={cycleSort}
            smoothScrollX
            smoothScrollY
            onColumnResize={onColumnResize}
            {...menuProps({ toAnchor, setMenu })}
            {...schemaEditorProps(schemaEditing, { edits, storedRowCount: rows.length, addRowHint: t('listGrid.addRowHint') })}
          />
        )}
      </div>
      <GlideOverlays
        columns={columns}
        rows={viewRows}
        edits={edits}
        menu={menu}
        renaming={renaming}
        schemaEditing={schemaEditing}
        sort={sort}
        filters={filters}
        storedIndexOf={storedIndexOf}
        onCloseMenu={() => setMenu(null)}
        onRename={(col) => openRename(col, menu?.at)}
        onInsertColumn={(index) => { setMenu(null); insertColumn(index) }}
        onCloseRename={() => setRenaming(null)}
        onSort={applySort}
        onFilter={applyFilter}
      />
      <ListGridGlideToolbar
        listID={listID}
        columns={columns}
        rows={viewRows}
        selection={selection}
        schemaEditing={schemaEditing}
        sort={sort}
        filters={filters}
        onAddRow={() => edits.insertRowAt(rows.length)}
        onAddColumn={() => insertColumn(columns.length)}
        onClearNarrowing={() => { setSort(null); setFilters({}) }}
      />
      {droppedRows > 0 && (
        <Text as="p" size="small" className={styles.errorLine} data-testid="list-grid-paste-dropped">{t('listGrid.pastedRowsDropped')}</Text>
      )}
      {edits.error && <p className={styles.errorLine} data-testid="atlas-projection-error">{edits.error}</p>}
      {editorPortal === 'host' && (
        // A fixed, zero-size box at the viewport origin: the library
        // positions its editor absolutely in viewport coordinates, so
        // this resolves them exactly like the body-level portal does.
        <div ref={portalRef} className={styles.editorPortal} data-testid="atlas-projection-glide-portal" />
      )}
    </div>
  )
}
