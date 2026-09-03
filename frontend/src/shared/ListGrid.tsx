import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionList, ActionMenu, Button, IconButton, Text } from '@primer/react'
import { KebabHorizontalIcon } from '@primer/octicons-react'
import { Type as FieldType } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'
import { RowStatus } from '../../bindings/github.com/alicoding/mill/internal/domain/list/models'
import { cellContent, rowTintStyle } from './listGridCells'
import { useListSchemaEdits } from './useListSchemaEdits'
import { ListGridColumnPopover } from './ListGridColumnPopover'
import styles from './ListGrid.module.css'

// The one grid (goal 0136): a List rendered as an editable table --
// the Atlas card face and Configure's List page are thin wrappers
// around this single definition, so the interaction language (cell
// click-to-edit, header click-to-rename, boundary-⊕ inserts, the
// header gear for schema, the row menu for status/delete) is authored
// once and reads identically everywhere. Every edit commits through
// the List's own ConfigureService methods -- the ungated direct-edit
// path (the guardrail gate governs workflow/agent side effects, never
// the user's own edits) -- and every other projection updates through
// the same data event. Test ids keep the shipped atlas-projection-*
// names: they are addresses, not copy, and both consumers share them.

export interface GridColumn {
  Key: string
  Label: string
  Type?: string
  Options: string[] | null
  OptionColors: string[] | null
  Deprecated?: boolean
}

export interface GridRow {
  ID: string
  Status: string
  Values: { [key: string]: string | undefined } | null
}

// The cell editor is an OVERLAY filling the cell's exact box (goal
// 0140: zero layout shift -- the row's height and every neighbor stay
// pixel-identical while editing). Plain token-styled form controls,
// deliberately not the kit's TextInput: its wrapper chrome is taller
// than a cell, and a bare input is a form control, not overlay
// machinery. Keyboard: Tab commits + moves right (Shift+Tab left),
// Enter commits + moves down, Escape cancels -- the spreadsheet
// model, identical in every consumer.
function GridCellEditor({ column, editing, onChange, onCommit, onCancel, onAdvance }: {
  column: GridColumn
  editing: { value: string }
  onChange: (value: string) => void
  onCommit: (value?: string) => void
  onCancel: () => void
  onAdvance: (dRow: number, dCol: number) => void
}) {
  const { t } = useTranslation('common')
  const navKeys = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      onAdvance(0, e.shiftKey ? -1 : 1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      onAdvance(1, 0)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
  }
  if ((column.Options?.length ?? 0) > 0 || column.Type === FieldType.TypeBoolean) {
    const options = (column.Options?.length ?? 0) > 0
      ? (column.Options ?? []).map((opt) => ({ value: opt, label: opt }))
      : [{ value: 'true', label: t('listGrid.booleanTrue') }, { value: 'false', label: t('listGrid.booleanFalse') }]
    return (
      <select
        autoFocus
        className={styles.cellEditor}
        value={editing.value}
        aria-label={column.Label || column.Key}
        data-testid="atlas-projection-cell-select"
        onChange={(e) => onCommit(e.target.value)}
        onBlur={() => onCommit()}
        onKeyDown={navKeys}
      >
        <option value="">{'—'}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    )
  }
  return (
    <input
      autoFocus
      className={styles.cellEditor}
      value={editing.value}
      type={column.Type === FieldType.TypeNumber ? 'number' : 'text'}
      aria-label={column.Label || column.Key}
      data-testid="atlas-projection-cell-input"
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => onCommit()}
      onKeyDown={navKeys}
    />
  )
}

export function ListGrid({ listID, columns, rows, density, schemaEditing = true }: {
  listID: string
  columns: GridColumn[]
  rows: GridRow[]
  density?: string
  // The header gear + row menu; the Atlas board face keeps them too --
  // false is for read-only mounts (none today; the prop documents the
  // seam rather than a consumer).
  schemaEditing?: boolean
}) {
  const { t } = useTranslation('common')
  const [editing, setEditing] = useState<{ rowID: string; key: string; value: string } | null>(null)
  // The focus layer between canvas and editing (goal 0143): Escape
  // from an edit lands HERE, arrows walk cells, Enter re-edits,
  // typing starts a fresh edit seeded with the keystroke, Escape
  // again returns to the canvas.
  const [focused, setFocused] = useState<{ rowID: string; key: string } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const [renaming, setRenaming] = useState<{ key: string; label: string } | null>(null)
  // Every round trip (cell commit, row insert/status/delete, schema
  // edits) is the shared hook's -- identical to the adopted grid's.
  const edits = useListSchemaEdits(listID, columns, rows)

  // Programmatic DOM focus follows the focused cell so its keydown
  // handler receives the arrows.
  useEffect(() => {
    if (!focused || editing) return
    const td = rootRef.current?.querySelector<HTMLTableCellElement>(`td[data-cell="${CSS.escape(focused.rowID)}|${CSS.escape(focused.key)}"]`)
    td?.focus()
  }, [focused, editing])

  const moveFocus = (dRow: number, dCol: number) => {
    if (!focused) return
    const rowIdx = rows.findIndex((r) => r?.ID === focused.rowID)
    const colIdx = columns.findIndex((c) => c.Key === focused.key)
    const row = rows[rowIdx + dRow]
    const col = columns[colIdx + dCol]
    if (!row || !col) return
    setFocused({ rowID: row.ID, key: col.Key })
  }

  const focusedCellKeyDown = (e: React.KeyboardEvent, row: GridRow, c: GridColumn) => {
    if (editing) return
    const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
    if (arrows[e.key]) {
      e.preventDefault()
      e.stopPropagation()
      moveFocus(...arrows[e.key])
      return
    }
    if (e.key === 'Enter' || e.key === 'F2') {
      e.preventDefault()
      e.stopPropagation()
      setEditing({ rowID: row.ID, key: c.Key, value: row.Values?.[c.Key] ?? '' })
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setFocused(null)
      ;(e.target as HTMLElement).blur()
      return
    }
    // A printable keystroke starts a fresh edit seeded with it (the
    // spreadsheet type-to-replace convention).
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault()
      e.stopPropagation()
      setEditing({ rowID: row.ID, key: c.Key, value: e.key })
    }
  }

  // advanceEdit commits the current cell and opens the neighbor
  // (goal 0140's Tab/Enter chain); off-grid movement just commits.
  const advanceEdit = (dRow: number, dCol: number) => {
    if (!editing) return
    const rowIdx = rows.findIndex((r) => r?.ID === editing.rowID)
    const colIdx = columns.findIndex((c) => c.Key === editing.key)
    commitCell()
    let nRow = rowIdx
    let nCol = colIdx + dCol
    if (nCol >= columns.length) {
      nCol = 0
      nRow++
    } else if (nCol < 0) {
      nCol = columns.length - 1
      nRow--
    }
    nRow += dRow
    const row = rows[nRow]
    const col = columns[nCol]
    if (!row || !col) return
    setFocused({ rowID: row.ID, key: col.Key })
    setEditing({ rowID: row.ID, key: col.Key, value: row.Values?.[col.Key] ?? '' })
  }

  const commitCell = (value?: string) => {
    if (!editing) return
    const row = rows.find((r) => r?.ID === editing.rowID)
    const edit = { ...editing, value: value ?? editing.value }
    setEditing(null)
    if (!row) return
    void edits.commitCell(row, edit.key, edit.value)
  }

  const insertRowAt = (index: number) => edits.insertRowAt(index)
  const setRowStatus = (row: GridRow, status: RowStatus) => edits.setRowStatus(row, status)
  const deleteRow = (rowID: string) => edits.deleteRow(rowID)

  // Straight into rename once the insert has LANDED (the hook resolves
  // with the new key only then).
  const insertColumnAt = (index: number) => {
    void edits.insertColumnAt(index).then((key) => { if (key) setRenaming({ key, label: '' }) })
  }

  const commitRename = () => {
    if (!renaming) return
    const rename = renaming
    setRenaming(null)
    edits.renameColumn(rename.key, rename.label)
  }

  const commitColumnChange = edits.changeColumn
  const removeColumn = edits.removeColumn
  const fieldFor = edits.fieldFor
  const error = edits.error

  const headerCell = (c: GridColumn, colIdx: number) => (
    <th key={c.Key} data-testid="atlas-projection-header" data-deprecated={c.Deprecated ? 'true' : undefined}>
      <span className={styles.headerInner}>
        <button
          type="button"
          className={styles.headerButton}
          title={t('listGrid.renameColumnTitle')}
          onClick={() => setRenaming({ key: c.Key, label: c.Label || c.Key })}
        >
          {c.Label || c.Key}
        </button>
        {renaming?.key === c.Key && (
          <input
            autoFocus
            className={styles.cellEditor}
            value={renaming.label}
            aria-label={t('listGrid.renameColumnAriaLabel')}
            data-testid="atlas-projection-rename-input"
            onChange={(e) => setRenaming({ ...renaming, label: e.target.value })}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') setRenaming(null)
            }}
          />
        )}
        {schemaEditing && (
          <ListGridColumnPopover
            column={fieldFor(c)}
            onCommit={commitColumnChange}
            onRemove={() => removeColumn(c.Key)}
          />
        )}
      </span>
      <button
        type="button"
        className={`${styles.insertDot} ${styles.insertDotColumn}`}
        aria-label={t('listGrid.insertColumnAriaLabel')}
        title={t('listGrid.insertColumnAriaLabel')}
        data-testid="atlas-projection-insert-column"
        onClick={() => insertColumnAt(colIdx + 1)}
      >
        +
      </button>
    </th>
  )

  return (
    <div ref={rootRef} className={styles.gridRoot} data-testid="atlas-projection-table">
      <div className={styles.scroll}>
        {columns.length === 0 ? (
          <Text as="p" size="small" className={styles.empty}>{t('listGrid.noColumns')}</Text>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>{columns.map(headerCell)}</tr>
            </thead>
            <tbody>
              {rows.map((row, rowIdx) => row && (
                <tr
                  key={row.ID}
                  data-testid="atlas-projection-row"
                  data-row-status={row.Status || 'active'}
                  style={density === 'pills' ? rowTintStyle(columns, row.Values ?? {}) : undefined}
                >
                  {columns.map((c, colIdx) => (
                    <td
                      key={c.Key}
                      data-testid="atlas-projection-cell"
                      data-cell={`${row.ID}|${c.Key}`}
                      data-focused={focused?.rowID === row.ID && focused.key === c.Key ? 'true' : undefined}
                      tabIndex={-1}
                      onKeyDown={(e) => focusedCellKeyDown(e, row, c)}
                      onClick={() => {
                        setFocused({ rowID: row.ID, key: c.Key })
                        setEditing({ rowID: row.ID, key: c.Key, value: row.Values?.[c.Key] ?? '' })
                      }}
                    >
                      <span className={styles.cellText}>{cellContent(c, row.Values?.[c.Key] ?? '')}</span>
                      {editing && editing.rowID === row.ID && editing.key === c.Key && (
                        <GridCellEditor
                          column={c}
                          editing={editing}
                          onChange={(value) => setEditing({ ...editing, value })}
                          onCommit={commitCell}
                          onCancel={() => { setEditing(null); setFocused({ rowID: row.ID, key: c.Key }) }}
                          onAdvance={advanceEdit}
                        />
                      )}
                      {colIdx === 0 && (
                        <span className={styles.rowAffordances}>
                          <button
                            type="button"
                            className={`${styles.insertDot} ${styles.insertDotRow}`}
                            aria-label={t('listGrid.insertRowAriaLabel')}
                            title={t('listGrid.insertRowAriaLabel')}
                            data-testid="atlas-projection-insert-row"
                            onClick={(e) => { e.stopPropagation(); insertRowAt(rowIdx + 1) }}
                          >
                            +
                          </button>
                          {schemaEditing && (
                            <span onClick={(e) => e.stopPropagation()} className={styles.rowMenu}>
                              <ActionMenu>
                                <ActionMenu.Anchor>
                                  <IconButton
                                    icon={KebabHorizontalIcon}
                                    size="small"
                                    variant="invisible"
                                    className={styles.rowMenuButton}
                                    data-testid="atlas-projection-row-menu"
                                    aria-label={t('listGrid.rowMenuAriaLabel')}
                                  />
                                </ActionMenu.Anchor>
                                <ActionMenu.Overlay>
                                  <ActionList>
                                    {row.Status === 'expired' ? (
                                      <ActionList.Item onSelect={() => setRowStatus(row, RowStatus.RowActive)} data-testid="list-grid-row-activate">
                                        {t('listGrid.markActive')}
                                      </ActionList.Item>
                                    ) : (
                                      <ActionList.Item onSelect={() => setRowStatus(row, RowStatus.RowExpired)} data-testid="list-grid-row-expire">
                                        {t('listGrid.markExpired')}
                                      </ActionList.Item>
                                    )}
                                    <ActionList.Item variant="danger" onSelect={() => deleteRow(row.ID)} data-testid="list-grid-row-delete">
                                      {t('listGrid.deleteRow')}
                                    </ActionList.Item>
                                  </ActionList>
                                </ActionMenu.Overlay>
                              </ActionMenu>
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className={styles.actionsRow}>
        {columns.length > 0 && (
          <Button size="small" variant="invisible" data-testid="atlas-projection-add-row" onClick={() => insertRowAt(rows.length)}>
            {t('listGrid.addRow')}
          </Button>
        )}
        <Button size="small" variant="invisible" data-testid="atlas-projection-add-column" onClick={() => insertColumnAt(columns.length)}>
          {t('listGrid.addColumn')}
        </Button>
      </div>
      {error && <Text as="p" size="small" className={styles.errorLine} data-testid="atlas-projection-error">{error}</Text>}
    </div>
  )
}
