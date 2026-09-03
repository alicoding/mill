import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@primer/react'
import { DataEditor, type DataEditorRef, type Rectangle } from '@glideapps/glide-data-grid'
import '@glideapps/glide-data-grid/dist/index.css'
import type { GridColumn, GridRow } from './ListGrid'
import { useListSchemaEdits } from './useListSchemaEdits'
import { optionsRenderer } from './listGridGlideCells'
import { GLIDE_DEFAULT_COLUMN_WIDTH, GLIDE_HEADER_HEIGHT, GLIDE_ROW_HEIGHT, paletteFromTokens } from './listGridGlideTheme'
import { anchorFromBounds, type Anchor } from './ListGridGlideMenus'
import { GlideOverlays, schemaEditorProps, useGlideCellEdits, useGlideColumns, useRowTint, type GlideMenuState } from './ListGridGlideOverlays'
import styles from './ListGrid.module.css'

// The adopted grid (ADR-0049, goal 0287): Glide Data Grid as the
// table's AUTHORING plane behind the same props ListGrid takes. Every
// cell interaction is the library's own -- click selects, a second
// click / Enter / typing edits, Enter commits down, Tab commits
// right, Escape cancels, ranges select / copy / paste / fill, Delete
// clears, headers resize and reorder by drag. The content plane stays
// Mill's: each commit is one UpdateListRow, a header drag is one
// UpdateList, through the same hook the hand-rolled grid uses
// (useListSchemaEdits). Schema editing is composed ON the grid: the
// header menu (its menu icon, or right-click) and the row menu
// (right-click) are Mill's menus anchored at the grid's own event
// rectangles; rename is an input laid over the header. The overlay
// editors mount in the body-level #portal the library requires
// (index.html).

// Column widths are per-device UI state (the schema has no width),
// keyed by list.
const widthsKey = (listID: string) => `mill-list-column-widths:${listID}`
function readWidths(listID: string): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(widthsKey(listID)) ?? '{}') as Record<string, number>
  } catch {
    return {}
  }
}

export function ListGridGlide({ listID, columns, rows, density, schemaEditing = true }: { listID: string; columns: GridColumn[]; rows: GridRow[]; density?: string; schemaEditing?: boolean }) {
  const { t } = useTranslation('common')
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  const gridRef = useRef<DataEditorRef>(null)
  const edits = useListSchemaEdits(listID, columns, rows)
  const palette = useMemo(() => paletteFromTokens(host), [host])
  const renderers = useMemo(() => [optionsRenderer(palette)], [palette])
  const [widths, setWidths] = useState<Record<string, number>>(() => readWidths(listID))
  const [menu, setMenu] = useState<GlideMenuState>(null)
  const [renaming, setRenaming] = useState<{ key: string; at: Anchor } | null>(null)
  const toAnchor = useCallback((bounds: Rectangle) => anchorFromBounds(host, bounds), [host])
  const gridColumns = useGlideColumns(columns, widths, schemaEditing, palette)
  const cellEdits = useGlideCellEdits(columns, rows, edits)
  const getRowThemeOverride = useRowTint(density, columns, rows, palette)

  const onColumnResize = useCallback((column: { id?: string }, newSize: number) => {
    setWidths((prev) => {
      const next = { ...prev, [String(column.id)]: newSize }
      try { localStorage.setItem(widthsKey(listID), JSON.stringify(next)) } catch { /* per-device convenience only */ }
      return next
    })
  }, [listID])

  const openRename = useCallback((col: number, at?: Anchor) => {
    const column = columns[col]
    const bounds = gridRef.current?.getBounds(col, -1)
    const where = at ?? (bounds && toAnchor(bounds))
    if (!column || !where) return
    setMenu(null)
    setRenaming({ key: column.Key, at: where })
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

  const height = GLIDE_HEADER_HEIGHT + (rows.length + (schemaEditing ? 1 : 0)) * GLIDE_ROW_HEIGHT + 2

  return (
    <div
      ref={setHost}
      className={styles.gridRoot}
      style={{ position: 'relative' }}
      data-testid="atlas-projection-glide"
      data-columns={columns.length}
      data-rows={rows.length}
      data-col-widths={columns.map((c) => widths[c.Key] ?? GLIDE_DEFAULT_COLUMN_WIDTH).join(',')}
      data-col-types={columns.map((c) => ((c.Options?.length ?? 0) > 0 ? 'options' : c.Type || 'text')).join(',')}
      data-header-height={GLIDE_HEADER_HEIGHT}
      data-row-height={GLIDE_ROW_HEIGHT}
      // Arrow keys and typing inside the grid belong to the grid --
      // never to the board's node keyboard handling (which would move
      // the object) nor the canvas's own shortcuts; a right-click is
      // the grid's header / row menu, never the object's own menu.
      onKeyDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div className={`${styles.scroll} nowheel nodrag`} style={{ minHeight: 120, maxHeight: 420 }}>
        {columns.length === 0 ? (
          <p className={styles.empty} data-testid="atlas-projection-empty">{t('listGrid.noColumns')}</p>
        ) : (
          <DataEditor
            ref={gridRef}
            columns={gridColumns}
            rows={rows.length}
            {...cellEdits}
            onPaste
            getCellsForSelection
            customRenderers={renderers}
            theme={palette.theme}
            getRowThemeOverride={getRowThemeOverride}
            width="100%"
            height={Math.min(420, height)}
            rowHeight={GLIDE_ROW_HEIGHT}
            headerHeight={GLIDE_HEADER_HEIGHT}
            rowMarkers="number"
            smoothScrollX
            smoothScrollY
            onColumnResize={onColumnResize}
            {...schemaEditorProps(schemaEditing, { edits, rows, toAnchor, setMenu, addRowHint: t('listGrid.addRowHint') })}
          />
        )}
      </div>
      <GlideOverlays
        columns={columns}
        rows={rows}
        edits={edits}
        menu={menu}
        renaming={renaming}
        onCloseMenu={() => setMenu(null)}
        onRename={(col) => openRename(col, menu?.at)}
        onInsertColumn={(index) => { setMenu(null); insertColumn(index) }}
        onCloseRename={() => setRenaming(null)}
      />
      <div className={styles.actionsRow}>
        {columns.length > 0 && (
          <Button size="small" variant="invisible" data-testid="atlas-projection-add-row" onClick={() => edits.insertRowAt(rows.length)}>{t('listGrid.addRow')}</Button>
        )}
        {schemaEditing && (
          <Button size="small" variant="invisible" data-testid="atlas-projection-add-column" onClick={() => insertColumn(columns.length)}>{t('listGrid.addColumn')}</Button>
        )}
      </div>
      {edits.error && <p className={styles.errorLine} data-testid="atlas-projection-error">{edits.error}</p>}
    </div>
  )
}
