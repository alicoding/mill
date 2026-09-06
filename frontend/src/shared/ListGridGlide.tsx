import type React from 'react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
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
import { findCommand, runCommand } from './commands'
import { comboFromEvent, comboKey, isUndoJournalCombo } from './keybinding'
import { useListGridSearchFocusStore } from './listGridSearchFocus'
import styles from './ListGrid.module.css'

// The adopted grid (ADR-0049, goals 0287 / 0349 S4): Glide Data Grid as
// the table's AUTHORING plane behind the same props ListGrid takes.
// Every interaction on it is the library's own -- click selects, drag
// or shift-click extends the range, a second click / Enter / typing
// edits, Enter commits down, Tab commits right, Escape cancels, copy
// and paste move the range through the clipboard, the fill handle
// fills it, Delete clears it, ⌘F opens the grid's own search while it
// holds focus, headers resize and reorder by drag. The content plane
// stays Mill's: every commit -- typed, pasted, filled or cleared --
// arrives as onCellsEdited and leaves as one UpdateListRow per row,
// through the same hook every mount uses (useListSchemaEdits). What
// the library leaves to the integrator by design is composed ON the
// grid rather than re-implemented inside it: the schema menus, the
// per-column sort and filter (listStandard.ts), the bulk actions
// (ListGridGlideToolbar.tsx), and the per-device column widths.

// Keybindings review (goal 0349 S4 gap): every entry DataEditor's own
// ConfigurableKeybinds type declares (data-editor-keybindings.ts),
// confirmed against the vendored source. Mill passes NO `keybindings`
// prop below -- every realized default stays exactly as the library
// ships it.
//
// | Keybind (default state)                                    | Realized combo                              |
// |-------------------------------------------------------------|----------------------------------------------|
// | copy / cut / paste (on)                                     | the platform's native copy/cut/paste keys     |
// | clear / closeOverlay (on)                                    | any+Escape                                    |
// | acceptOverlayDown / Up / Left / Right (on)                   | Enter / shift+Enter / shift+Tab / Tab         |
// | activateCell (on)                                            | Enter / shift+Enter                           |
// | delete (on)                                                  | Backspace or Delete (macOS), Delete elsewhere |
// | scrollToSelectedCell (on)                                    | primary+Enter                                 |
// | goToFirst/LastCell/Column/Row, goToNext/PreviousPage (on)    | Home/End/PageUp/PageDown family               |
// | goUp/Down/Left/RightCell, +RetainSelection variants (on)     | Arrow keys, +alt for the retain-selection set |
// | selectToFirst/LastCell/Column/Row (on)                       | primary+shift+Home/End/Arrow family           |
// | selectGrowUp/Down/Left/Right (on)                            | shift+Arrow                                   |
// | selectAll / selectRow / selectColumn (on)                    | primary+a / shift+Space / ctrl+Space          |
// | downFill / rightFill (OFF)                                   | no combo -- Mill never binds these            |
// | search (OFF)                                                 | no combo -- see listGrid.search instead       |
//
// `search` ships OFF: enabling it would hand ⌘F to the library's own
// UNCONTROLLED show/hide state, which this component cannot then also
// drive from the registry command (listGridCommands.ts's
// listGrid.search). Mill instead controls `showSearch`/`onSearchClose`
// itself (the library's own documented controlled-search shape) and
// detects ⌘F locally -- the one addition to the table above, not a
// keybindings override.

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

// The pin is the 6.0.4 pre-release, not the 6.0.3 stable: 6.0.3's peers
// name react 16-18 (Mill runs 19) and marked ^4 (Mill runs 16, required
// by the diagram renderer), so `npm ci` cannot resolve it at all, and it
// resolves its overlay editor's mount as document.getElementById
// ('portal') with no override -- portalElementRef below, which the
// focus-trapped card page needs, exists only from 6.0.4.

// editorPortal: where the library mounts its overlay cell editor.
// 'body' (default) is its own body-level #portal, which keeps the
// editor out of any CSS-transformed ancestor (a board object scales
// with the canvas). 'host' mounts it inside this grid's own tree --
// required inside a focus-trapping dialog (the card page): a trap
// pulls focus back from anything outside its subtree, so a body-level
// editor never receives keystrokes and every commit is lost.
export function ListGridGlide({ listID, columns, rows, density, schemaEditing = true, editorPortal = 'body', onEditingChange }: { listID: string; columns: GridColumn[]; rows: GridRow[]; density?: string; schemaEditing?: boolean; editorPortal?: 'body' | 'host'; onEditingChange?: (editing: boolean) => void }) {
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

  // The grid's own search (goal 0349 S4 gap): showSearch/onSearchClose
  // controlled the way the library's own built-in-search example wires
  // them, so listGrid.search's run() -- which cannot reach a specific
  // mount's state directly -- has a handle to call through.
  //
  // ⌘F is read off a keydown TARGETED inside this host (onKeyDown
  // below), so a click must leave DOM focus in here before the next
  // keystroke. The library's own click-to-focus defers to a
  // requestAnimationFrame, which a loaded machine can push past the
  // keystroke -- so the click takes focus through the library's own
  // imperative handle (DataEditorRef.focus) as well, on POINTERUP.
  //
  // Never on pointerdown: the library's onCanvasFocused auto-selects
  // the first cell when the canvas gains focus with no selection,
  // suppressed only while a mouse button is already down. Pointerdown
  // precedes the library's own mousedown, so focusing there beats
  // that suppression, pre-selects the clicked cell, and turns the
  // user's FIRST click into the library's second-click activation --
  // an overlay editor instead of a selected cell. By pointerup the
  // library's mousedown has both armed the suppression and set the
  // selection, so neither can happen.
  const [showSearch, setShowSearch] = useState(false)
  const searchHandleID = useId()
  const setSearchFocused = useListGridSearchFocusStore((s) => s.setFocused)
  const clearSearchFocused = useListGridSearchFocusStore((s) => s.clearFocused)
  const publishSearchHandle = useCallback(() => {
    setSearchFocused({ id: searchHandleID, toggleSearch: () => setShowSearch((v) => !v) })
  }, [setSearchFocused, searchHandleID])
  useEffect(() => () => clearSearchFocused(searchHandleID), [clearSearchFocused, searchHandleID])

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

  // The overlay cell editor's own open/close, reported to the host
  // (goal 0354): the library activates a cell (its second-click model,
  // Enter, or a double-click) and mounts the editor, then fires
  // onFinishedEditing when it closes, whether the edit committed or was
  // cancelled. A board object turns that into its `editing` activation
  // state; every other consumer passes nothing and pays nothing.
  const reportEditing = useCallback((editing: boolean) => { onEditingChange?.(editing) }, [onEditingChange])

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
      data-search-open={showSearch ? 'true' : undefined}
      // The focus handle every listGrid.search invocation acts through
      // (listGridSearchFocus.ts): published whenever focus lands
      // anywhere in this grid, cleared only if it's still this mount's
      // own handle (focus can leave and a different mount can claim it
      // in either order).
      onFocus={publishSearchHandle}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) clearSearchFocused(searchHandleID) }}
      // Arrow keys and typing inside the grid belong to the grid --
      // never to the board's node keyboard handling (which would move
      // the object) nor the canvas's own shortcuts; a right-click is
      // the grid's header / row menu, never the object's own menu.
      // Escape is the one key handed back -- see the capture listener
      // above. ⌘F is the one keystroke this component itself dispatches
      // through the registry (listGridCommands.ts's listGrid.search):
      // every keydown in here is stopped from ever reaching the
      // window's own keymap dispatcher (app/useKeymapDispatch.ts), so
      // that dispatcher can never see this combo either -- the combo
      // compared against is listGrid.search's own defaultBinding, read
      // fresh, rather than a second hardcoded copy of it. Only while
      // search is CLOSED: once open, the library's own search input
      // closes on ⌘F/Escape itself (its onSearchClose, wired below), so
      // this never double-toggles.
      //
      // ⌘Z/⇧⌘Z are the ONE exception to the containment above: a cell
      // edit, a row insert and a row delete are steps on the app's one
      // undo journal (ADR-0044, goal 0352), and the grid's own library
      // ships no undo to contest them, so the combo bubbles to the
      // window's dispatcher instead of dying here. Without this,
      // pressing ⌘Z with a cell selected -- the moment every
      // spreadsheet undoes the edit just made -- did nothing at all.
      onKeyDown={(e) => {
        if (!showSearch) {
          const pressed = comboFromEvent(e.nativeEvent)
          const binding = findCommand('listGrid.search')?.defaultBinding
          if (pressed && binding && comboKey(pressed.mods, pressed.key) === comboKey(binding.mods, binding.key)) {
            e.preventDefault()
            void runCommand('listGrid.search', { kind: 'listGrid', listID, rowIDs: [] })
          }
        }
        if (isUndoJournalCombo(e.nativeEvent)) return
        e.stopPropagation()
      }}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div
        className={`${styles.scroll} nowheel nodrag nopan`}
        style={{ minHeight: 120, maxHeight: 420 }}
        // See the search block above for why this is pointerUP, and why
        // it must never move to pointerdown. Skipped when focus is
        // already in here, so it can never pull it off an open overlay
        // editor that mounts inside this host.
        onPointerUp={() => { if (!host?.contains(document.activeElement)) gridRef.current?.focus() }}
      >
        {columns.length === 0 ? (
          <p className={styles.empty} data-testid="atlas-projection-empty">{t('listGrid.noColumns')}</p>
        ) : (
          <DataEditor
            ref={gridRef}
            portalElementRef={editorPortal === 'host' ? (portalRef as React.RefObject<HTMLElement>) : undefined}
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
            showSearch={showSearch}
            onSearchClose={() => setShowSearch(false)}
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
            onCellActivated={() => reportEditing(true)}
            onFinishedEditing={() => reportEditing(false)}
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
