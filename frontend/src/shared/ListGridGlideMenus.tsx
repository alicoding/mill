import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionList, ActionMenu } from '@primer/react'
import type { Field } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'
import { RowStatus } from '../../bindings/github.com/alicoding/mill/internal/domain/list/models'
import type { GridColumn, GridRow } from './listGridTypes'
import { ListGridColumnPopover } from './ListGridColumnPopover'
import { ListGridGlideFilter } from './ListGridGlideFilter'
import type { GridColumnFilter, GridSortDirection } from './listStandard'
import styles from './ListGrid.module.css'

// The adopted grid's schema and row menus (ADR-0049 §2: schema editing
// stays Mill's, composed on the grid's header and cell events). The
// grid reports a screen rectangle; each menu anchors an invisible
// element there, inside the grid host, so the kit's own positioning
// does the rest -- the same ActionMenu/ActionList the hand-rolled
// grid's row menu used, the same column popover for type / options /
// deprecate / remove.

export interface Anchor { x: number; y: number; width: number; height: number }

// Screen rectangle -> host-relative CSS px (the board's zoom scales
// the host, the grid reports unscaled screen px).
export function anchorFromBounds(host: HTMLElement | null, bounds: Anchor): Anchor {
  const rect = host?.getBoundingClientRect()
  const scale = host && rect ? rect.width / host.offsetWidth || 1 : 1
  return {
    x: (bounds.x - (rect?.left ?? 0)) / scale,
    y: (bounds.y - (rect?.top ?? 0)) / scale,
    width: bounds.width / scale,
    height: bounds.height / scale,
  }
}

// AnchorBox places a zero-size anchor at a host-relative rectangle.
function AnchorBox({ at, anchorRef }: { at: Anchor; anchorRef: React.RefObject<HTMLDivElement | null> }) {
  return <div ref={anchorRef} style={{ position: 'absolute', left: at.x, top: at.y, width: at.width, height: at.height, pointerEvents: 'none' }} />
}

export function ColumnMenu({ column, field, at, sort, filter, schemaEditing, onClose, onRename, onInsert, onChange, onRemove, onSort, onFilter }: {
  column: GridColumn
  field: Field
  at: Anchor
  // This column's own share of the grid's narrowing (goal 0349 S4):
  // undefined when it is not the sorted column.
  sort: GridSortDirection | undefined
  filter: GridColumnFilter
  // A read-only mount still sorts and filters; only the schema items
  // (rename, insert, type and choices) belong to an editable one.
  schemaEditing: boolean
  onClose: () => void
  onRename: () => void
  onInsert: (side: 'left' | 'right') => void
  onChange: (next: Field) => void
  onRemove: () => void
  onSort: (direction: GridSortDirection | undefined) => void
  onFilter: (next: GridColumnFilter) => void
}) {
  const { t } = useTranslation('common')
  const anchorRef = useRef<HTMLDivElement>(null)
  const [panel, setPanel] = useState<'settings' | 'filter' | null>(null)
  // Choosing an item closes the menu (its own onOpenChange) -- that
  // close must hand over to the panel it opened, not tear it all down.
  const switching = useRef(false)
  const openPanel = (next: 'settings' | 'filter') => {
    switching.current = true
    setPanel(next)
  }
  const pick = (run: () => void) => () => { onClose(); run() }
  return (
    <>
      <AnchorBox at={at} anchorRef={anchorRef} />
      {panel === null && (
        <ActionMenu open onOpenChange={(open) => { if (!open && !switching.current) onClose() }} anchorRef={anchorRef}>
          <ActionMenu.Overlay>
            <ActionList data-testid="list-grid-column-menu">
              <ActionList.Item onSelect={pick(() => onSort('asc'))} data-testid="list-grid-column-sort-asc">{t('listGrid.sortAscending')}</ActionList.Item>
              <ActionList.Item onSelect={pick(() => onSort('desc'))} data-testid="list-grid-column-sort-desc">{t('listGrid.sortDescending')}</ActionList.Item>
              {sort !== undefined && (
                <ActionList.Item onSelect={pick(() => onSort(undefined))} data-testid="list-grid-column-sort-clear">{t('listGrid.clearSort')}</ActionList.Item>
              )}
              <ActionList.Item onSelect={() => openPanel('filter')} data-testid="list-grid-column-filter">{t('listGrid.filterColumn')}</ActionList.Item>
              {schemaEditing && <ActionList.Divider />}
              {schemaEditing && <ActionList.Item onSelect={onRename} data-testid="list-grid-column-rename">{t('listGrid.renameColumn')}</ActionList.Item>}
              {schemaEditing && <ActionList.Item onSelect={() => onInsert('left')} data-testid="list-grid-column-insert-left">{t('listGrid.insertColumnLeft')}</ActionList.Item>}
              {schemaEditing && <ActionList.Item onSelect={() => onInsert('right')} data-testid="atlas-projection-insert-column">{t('listGrid.insertColumnRight')}</ActionList.Item>}
              {schemaEditing && <ActionList.Item onSelect={() => openPanel('settings')} data-testid={`list-grid-column-settings-${column.Key}`}>{t('listGrid.columnSettings')}</ActionList.Item>}
            </ActionList>
          </ActionMenu.Overlay>
        </ActionMenu>
      )}
      {panel === 'settings' && (
        <ListGridColumnPopover column={field} onCommit={onChange} onRemove={onRemove} open onClose={onClose} anchorRef={anchorRef} />
      )}
      {panel === 'filter' && (
        <ListGridGlideFilter column={column} filter={filter} onApply={onFilter} onClose={onClose} anchorRef={anchorRef} />
      )}
    </>
  )
}

export function RowMenu({ row, at, onClose, onInsertBelow, onStatus, onDelete }: {
  row: GridRow
  at: Anchor
  onClose: () => void
  onInsertBelow: () => void
  onStatus: (status: RowStatus) => void
  onDelete: () => void
}) {
  const { t } = useTranslation('common')
  const anchorRef = useRef<HTMLDivElement>(null)
  return (
    <>
      <AnchorBox at={at} anchorRef={anchorRef} />
      <ActionMenu open onOpenChange={(open) => { if (!open) onClose() }} anchorRef={anchorRef}>
        <ActionMenu.Overlay>
          <ActionList data-testid="list-grid-row-menu">
            <ActionList.Item onSelect={onInsertBelow} data-testid="atlas-projection-insert-row">{t('listGrid.insertRowBelow')}</ActionList.Item>
            {row.Status === 'expired' ? (
              <ActionList.Item onSelect={() => onStatus(RowStatus.RowActive)} data-testid="list-grid-row-activate">{t('listGrid.markActive')}</ActionList.Item>
            ) : (
              <ActionList.Item onSelect={() => onStatus(RowStatus.RowExpired)} data-testid="list-grid-row-expire">{t('listGrid.markExpired')}</ActionList.Item>
            )}
            <ActionList.Item variant="danger" onSelect={onDelete} data-testid="list-grid-row-delete">{t('listGrid.deleteRow')}</ActionList.Item>
          </ActionList>
        </ActionMenu.Overlay>
      </ActionMenu>
    </>
  )
}

// RenameOverlay is the header rename input, laid over the header
// cell's rectangle: Enter commits, Escape cancels, blur commits --
// the hand-rolled grid's own contract, unchanged.
export function RenameOverlay({ at, initial, onCommit, onCancel }: {
  at: Anchor
  initial: string
  onCommit: (label: string) => void
  onCancel: () => void
}) {
  const { t } = useTranslation('common')
  const [label, setLabel] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus(); ref.current?.select() }, [])
  const done = useRef(false)
  const commit = () => {
    if (done.current) return
    done.current = true
    onCommit(label)
  }
  return (
    <input
      ref={ref}
      className={styles.cellEditor}
      style={{ position: 'absolute', left: at.x, top: at.y, width: at.width, height: at.height, zIndex: 3, font: '600 11px inherit', fontFamily: 'inherit' }}
      value={label}
      aria-label={t('listGrid.renameColumnAriaLabel')}
      data-testid="atlas-projection-rename-input"
      onChange={(e) => setLabel(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') { done.current = true; onCancel() }
      }}
    />
  )
}
