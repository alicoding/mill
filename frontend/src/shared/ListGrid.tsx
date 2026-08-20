import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionList, ActionMenu, Button, Label, Select, Text, TextInput } from '@primer/react'
import { KebabHorizontalIcon } from '@primer/octicons-react'
import { ConfigureService } from './bindings'
import { type Field, Type as FieldType } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'
import { RowStatus } from '../../bindings/github.com/alicoding/mill/internal/domain/list/models'
import { nextColumnKey } from './projectionColumns'
import { optionColor } from './projectionColors'
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

// cellContent renders an options value as its colored pill; anything
// else (plain text, or a value outside the declared options) stays
// text.
function cellContent(c: GridColumn, value: string) {
  if (!value || (c.Options?.length ?? 0) === 0) return value
  const color = optionColor(c.Options, c.OptionColors, value)
  if (!color) return value
  return <Label size="small" variant={color} data-testid="atlas-projection-pill">{value}</Label>
}

// The pills density tints each row by its FIRST options column's
// value color (the status-board reading: a row IS its state).
function rowTintStyle(columns: GridColumn[], values: { [key: string]: string | undefined }) {
  const statusCol = columns.find((c) => (c.Options?.length ?? 0) > 0)
  if (!statusCol) return undefined
  const color = optionColor(statusCol.Options, statusCol.OptionColors, values[statusCol.Key] ?? '')
  if (!color) return undefined
  return { background: `var(--bgColor-${color}-muted)` }
}

function GridCellEditor({ column, editing, onChange, onCommit, onCancel }: {
  column: GridColumn
  editing: { value: string }
  onChange: (value: string) => void
  onCommit: (value?: string) => void
  onCancel: () => void
}) {
  const { t } = useTranslation('common')
  if ((column.Options?.length ?? 0) > 0) {
    // An options column edits as a select over its own declared
    // values -- committed immediately on pick (nothing to type).
    return (
      <Select
        autoFocus size="small" value={editing.value}
        aria-label={column.Label || column.Key}
        data-testid="atlas-projection-cell-select"
        onChange={(e) => onCommit(e.target.value)}
        onBlur={() => onCommit()}
      >
        <Select.Option value="">{'—'}</Select.Option>
        {(column.Options ?? []).map((opt) => <Select.Option key={opt} value={opt}>{opt}</Select.Option>)}
      </Select>
    )
  }
  if (column.Type === FieldType.TypeBoolean) {
    return (
      <Select
        autoFocus size="small" value={editing.value}
        aria-label={column.Label || column.Key}
        data-testid="atlas-projection-cell-select"
        onChange={(e) => onCommit(e.target.value)}
        onBlur={() => onCommit()}
      >
        <Select.Option value="">{'—'}</Select.Option>
        <Select.Option value="true">{t('listGrid.booleanTrue')}</Select.Option>
        <Select.Option value="false">{t('listGrid.booleanFalse')}</Select.Option>
      </Select>
    )
  }
  return (
    <TextInput
      autoFocus size="small" value={editing.value}
      type={column.Type === FieldType.TypeNumber ? 'number' : 'text'}
      aria-label={column.Label || column.Key}
      data-testid="atlas-projection-cell-input"
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => onCommit()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit()
        if (e.key === 'Escape') onCancel()
      }}
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
  const [renaming, setRenaming] = useState<{ key: string; label: string } | null>(null)
  const [error, setError] = useState('')

  const report = (err: unknown) => setError(String(err))
  const clearThen = () => setError('')

  const commitCell = (value?: string) => {
    if (!editing) return
    const row = rows.find((r) => r?.ID === editing.rowID)
    const edit = { ...editing, value: value ?? editing.value }
    setEditing(null)
    if (!row) return
    const values = { ...(row.Values ?? {}), [edit.key]: edit.value }
    ConfigureService.UpdateListRow(listID, row.ID, values, (row.Status || 'active') as RowStatus)
      .then(clearThen).catch(report)
  }

  const insertRowAt = (index: number) => {
    ConfigureService.AddListRowAt(listID, {}, index).then(clearThen).catch(report)
  }

  const setRowStatus = (row: GridRow, status: RowStatus) => {
    const values = Object.fromEntries(Object.entries(row.Values ?? {}).map(([k, v]) => [k, v ?? '']))
    ConfigureService.UpdateListRow(listID, row.ID, values, status).then(clearThen).catch(report)
  }

  const deleteRow = (rowID: string) => {
    ConfigureService.DeleteListRow(listID, rowID).then(clearThen).catch(report)
  }

  // withList runs fn against the List's CURRENT full record
  // (UpdateList replaces the whole columns slice, so schema edits need
  // label+description+columns as they stand right now; new tombstones
  // MERGE server-side, so passing null never wipes stored ones).
  const withList = (fn: (l: { ID: string; Label: string; Description: string; Columns: Field[] | null }) => Promise<unknown> | undefined) => {
    void ConfigureService.Lists().then((lists) => {
      const l = (lists ?? []).find((x) => x.ID === listID)
      if (!l) return
      return fn(l)
    }).then(clearThen).catch(report)
  }

  const insertColumnAt = (index: number) => {
    withList((l) => {
      const cols = l.Columns ?? []
      const key = nextColumnKey(t('listGrid.newColumnLabel'), cols.map((c) => c.Key))
      const newColumn: Field = {
        Key: key, Label: t('listGrid.newColumnLabel'), Type: FieldType.TypeText,
        Required: false, Default: '', Description: '', Options: null,
        Suggestions: null, Secret: false, RefKind: '', Multiline: false, SystemManaged: false,
      }
      const next = [...cols.slice(0, index), newColumn, ...cols.slice(index)]
      // Straight into rename once the insert has LANDED -- opening it
      // earlier races the rename's own read-modify-write against the
      // insert's, and the loser silently drops the other's column.
      return ConfigureService.UpdateList(l.ID, l.Label, l.Description, next, null)
        .then(() => setRenaming({ key, label: '' }))
    })
  }

  // A rename on a column that holds NO data yet also re-keys it from
  // the new label (tombstoning the placeholder key): grid-authored
  // schemas get real keys ("SKU" -> sku) for workflows and imports to
  // match on, while a data-bearing column keeps its immutable key and
  // renames label-only (the schema-evolution guard's split).
  const commitRename = () => {
    if (!renaming) return
    const rename = renaming
    setRenaming(null)
    if (!rename.label.trim()) return
    const label = rename.label.trim()
    const hasData = rows.some((r) => (r.Values?.[rename.key] ?? '') !== '')
    withList((l) => {
      const cols = l.Columns ?? []
      const target = cols.find((c) => c.Key === rename.key)
      if (!target) return
      if (hasData) {
        const next = cols.map((c) => (c.Key === rename.key ? { ...c, Label: label } : c))
        return ConfigureService.UpdateList(l.ID, l.Label, l.Description, next, null)
      }
      const newKey = nextColumnKey(label, cols.map((c) => c.Key))
      const next = cols.map((c) => (c.Key === rename.key ? { ...c, Key: newKey, Label: label } : c))
      return ConfigureService.UpdateList(l.ID, l.Label, l.Description, next, [{ Key: target.Key, Type: target.Type }])
    })
  }

  // Merge ONLY the popover-editable facets onto the stored column --
  // replacing wholesale would wipe facets the render column doesn't
  // carry (Default, Description, Required...).
  const commitColumnChange = (next: Field) => {
    withList((l) => {
      const cols = (l.Columns ?? []).map((c) => (c.Key === next.Key
        ? { ...c, Type: next.Type, Options: next.Options, deprecated: next.deprecated }
        : c))
      return ConfigureService.UpdateList(l.ID, l.Label, l.Description, cols, null)
    })
  }

  const removeColumn = (key: string) => {
    withList((l) => {
      const removed = (l.Columns ?? []).find((c) => c.Key === key)
      if (!removed) return
      const cols = (l.Columns ?? []).filter((c) => c.Key !== key)
      return ConfigureService.UpdateList(l.ID, l.Label, l.Description, cols, [{ Key: removed.Key, Type: removed.Type }])
    })
  }

  const headerCell = (c: GridColumn, colIdx: number) => (
    <th key={c.Key} data-testid="atlas-projection-header" data-deprecated={c.Deprecated ? 'true' : undefined}>
      <span className={styles.headerInner}>
        {renaming?.key === c.Key ? (
          <TextInput
            autoFocus size="small" value={renaming.label}
            aria-label={t('listGrid.renameColumnAriaLabel')}
            data-testid="atlas-projection-rename-input"
            onChange={(e) => setRenaming({ ...renaming, label: e.target.value })}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') setRenaming(null)
            }}
          />
        ) : (
          <button
            type="button"
            className={styles.headerButton}
            title={t('listGrid.renameColumnTitle')}
            onClick={() => setRenaming({ key: c.Key, label: c.Label || c.Key })}
          >
            {c.Label || c.Key}
          </button>
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

  // fieldFor lifts a render column back to a full Field for the
  // popover -- the authoritative record is re-read in withList at
  // commit time, so only identity and the editable facets matter here.
  const fieldFor = (c: GridColumn): Field => ({
    Key: c.Key, Label: c.Label, Type: (c.Type || 'text') as Field['Type'],
    Required: false, Default: '', Description: '', Options: c.Options,
    Suggestions: null, Secret: false, RefKind: '', Multiline: false, SystemManaged: false,
    deprecated: c.Deprecated ?? false,
  })

  return (
    <div className={styles.gridRoot} data-testid="atlas-projection-table">
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
                      onClick={() => setEditing({ rowID: row.ID, key: c.Key, value: row.Values?.[c.Key] ?? '' })}
                    >
                      {editing && editing.rowID === row.ID && editing.key === c.Key ? (
                        <GridCellEditor
                          column={c}
                          editing={editing}
                          onChange={(value) => setEditing({ ...editing, value })}
                          onCommit={commitCell}
                          onCancel={() => setEditing(null)}
                        />
                      ) : (
                        cellContent(c, row.Values?.[c.Key] ?? '')
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
                                <ActionMenu.Button
                                  leadingVisual={KebabHorizontalIcon}
                                  size="small"
                                  variant="invisible"
                                  data-testid="atlas-projection-row-menu"
                                  aria-label={t('listGrid.rowMenuAriaLabel')}
                                >
                                  {''}
                                </ActionMenu.Button>
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
