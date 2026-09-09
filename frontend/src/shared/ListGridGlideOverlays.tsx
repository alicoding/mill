import { useTranslation } from 'react-i18next'
import { IconButton } from '@primer/react'
import { PlusIcon } from '@primer/octicons-react'
import type { GridColumn, GridRow } from './listGridTypes'
import { ColumnMenu, RenameOverlay, RowMenu } from './ListGridGlideMenus'
import type { Anchor } from './listGridGlideAnchor'
import type { GridColumnFilter, GridColumnFilters, GridColumnSort, GridSortDirection } from './listStandard'
import styles from './ListGrid.module.css'
import type { Edits, GlideMenuState } from './listGridGlideOverlaysLogic'

// ListGridGlide's two halves that are not the grid mount itself
// (split at the kit's complexity gate): the cell-edit callbacks the
// grid calls and the schema/row prop builders live in
// listGridGlideOverlaysLogic.ts (goal 0419 S1b) -- none of them is a
// component, so mixing them into this file with AddColumnButton/
// AddColumnRail/GlideOverlays broke react-refresh/only-export-components.
// Callers reach the logic exports through that file directly.

// The grid's own "add a column" affordance (goal 0349 S4 Part B): a
// small button, never the toolbar underneath the grid the library's
// own placements replace. Shared by the header-end rail (AddColumnRail,
// once the grid is mounted) and the empty state (before any column
// exists, so nothing is mounted yet to carry a rail). A real component
// (capitalized, per React's own convention) so it can resolve its own
// label -- listGridGlideOverlaysLogic.ts's schemaEditorProps is a
// plain builder function, not a component, and cannot call a hook
// itself.
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
