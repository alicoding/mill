import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfigureService } from './bindings'
import { type Field, Type as FieldType } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'
import { RowStatus } from '../../bindings/github.com/alicoding/mill/internal/domain/list/models'
import { nextColumnKey } from './projectionColumns'
import type { GridColumn, GridRow } from './listGridTypes'

// The List's edit round trips, shared by every grid implementation
// (ADR-0049): a cell commit, a row insert/status/delete, and the
// schema read-modify-writes (insert/rename/retype/deprecate/remove/
// reorder a column). Nothing here is grid logic -- it is the content
// plane's own contract, so the hand-rolled grid and the adopted one
// call the identical functions and read the identical error line.

type ListRecord = { ID: string; Label: string; Description: string; Columns: Field[] | null }

export function useListSchemaEdits(listID: string, columns: GridColumn[], rows: GridRow[]) {
  const { t } = useTranslation('common')
  const [error, setError] = useState('')
  const report = (err: unknown) => setError(String(err))
  const clearThen = () => setError('')

  // Rapid commits in one row must not lose each other: UpdateListRow
  // replaces the row's whole values map, and the rows PROP lags the
  // server, so a Tab-chain's second commit built from props alone
  // would wipe the first (goal 0140's keyboard chain surfaced it).
  // This ref carries the session's own commits until fresh rows land.
  const committedRef = useRef(new Map<string, Record<string, string>>())
  useEffect(() => {
    committedRef.current.clear()
  }, [rows])

  // updateRowValues writes a patch of one row's cells as ONE
  // UpdateListRow, merged over the row's current values and this
  // session's still-in-flight commits.
  const updateRowValues = (row: GridRow, patch: Record<string, string>): Promise<void> => {
    const values: Record<string, string> = {}
    for (const [k, v] of Object.entries(row.Values ?? {})) values[k] = v ?? ''
    Object.assign(values, committedRef.current.get(row.ID))
    Object.assign(values, patch)
    committedRef.current.set(row.ID, values)
    return ConfigureService.UpdateListRow(listID, row.ID, values, (row.Status || 'active') as RowStatus)
      .then(clearThen).catch(report)
  }

  const commitCell = (row: GridRow, key: string, value: string): Promise<void> => updateRowValues(row, { [key]: value })

  // appendRowsWithValues creates rows at the END, in order, each with
  // its values already set -- the door a paste that overflows the last
  // row goes through (goal 0349 S4). Sequential, never concurrent:
  // AddListRowAt appends to the record it re-reads, so parallel calls
  // would race each other's read-modify-write.
  const appendRowsWithValues = async (valueMaps: Record<string, string>[]): Promise<void> => {
    try {
      for (const values of valueMaps) {
        await ConfigureService.AddListRowAt(listID, values, -1)
      }
      clearThen()
    } catch (err) {
      report(err)
    }
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
  // MERGE server-side, so passing null never wipes stored ones). One
  // GetList, never a fetch of every list (goal 0147).
  const withList = <T,>(fn: (l: ListRecord) => Promise<T> | T | undefined): Promise<T | undefined> =>
    ConfigureService.GetList(listID).then((l) => fn(l)).then((v) => { clearThen(); return v }).catch((err) => { report(err); return undefined })

  // insertColumnAt resolves with the new column's key once the insert
  // has LANDED -- a rename opened earlier races its own read-modify-
  // write against the insert's, and the loser silently drops the
  // other's column.
  const insertColumnAt = (index: number): Promise<string | undefined> =>
    withList((l) => {
      const cols = l.Columns ?? []
      const key = nextColumnKey(t('listGrid.newColumnLabel'), cols.map((c) => c.Key))
      const newColumn: Field = {
        Key: key, Label: t('listGrid.newColumnLabel'), Type: FieldType.TypeText,
        Required: false, Default: '', Description: '', Options: null,
        Suggestions: null, Secret: false, RefKind: '', Multiline: false, SystemManaged: false,
      }
      const next = [...cols.slice(0, index), newColumn, ...cols.slice(index)]
      return ConfigureService.UpdateList(l.ID, l.Label, l.Description, next, null).then(() => key)
    })

  // A rename on a column that holds NO data yet also re-keys it from
  // the new label (tombstoning the placeholder key): grid-authored
  // schemas get real keys ("SKU" -> sku) for workflows and imports to
  // match on, while a data-bearing column keeps its immutable key and
  // renames label-only (the schema-evolution guard's split).
  const renameColumn = (key: string, rawLabel: string) => {
    const label = rawLabel.trim()
    if (!label) return
    const hasData = rows.some((r) => (r.Values?.[key] ?? '') !== '')
    void withList((l) => {
      const cols = l.Columns ?? []
      const target = cols.find((c) => c.Key === key)
      if (!target) return
      if (hasData) {
        const next = cols.map((c) => (c.Key === key ? { ...c, Label: label } : c))
        return ConfigureService.UpdateList(l.ID, l.Label, l.Description, next, null)
      }
      const newKey = nextColumnKey(label, cols.map((c) => c.Key))
      const next = cols.map((c) => (c.Key === key ? { ...c, Key: newKey, Label: label } : c))
      return ConfigureService.UpdateList(l.ID, l.Label, l.Description, next, [{ Key: target.Key, Type: target.Type }])
    })
  }

  // Merge ONLY the popover-editable facets onto the stored column --
  // replacing wholesale would wipe facets the render column doesn't
  // carry (Default, Description, Required...).
  const changeColumn = (next: Field) => {
    void withList((l) => {
      const cols = (l.Columns ?? []).map((c) => (c.Key === next.Key
        ? { ...c, Type: next.Type, Options: next.Options, deprecated: next.deprecated }
        : c))
      return ConfigureService.UpdateList(l.ID, l.Label, l.Description, cols, null)
    })
  }

  const removeColumn = (key: string) => {
    void withList((l) => {
      const removed = (l.Columns ?? []).find((c) => c.Key === key)
      if (!removed) return
      const cols = (l.Columns ?? []).filter((c) => c.Key !== key)
      return ConfigureService.UpdateList(l.ID, l.Label, l.Description, cols, [{ Key: removed.Key, Type: removed.Type }])
    })
  }

  // moveColumn reorders the schema itself: column order IS the List's
  // own order, so a header drag persists for every projection.
  const moveColumn = (from: number, to: number) => {
    if (from === to) return
    void withList((l) => {
      const cols = [...(l.Columns ?? [])]
      const [moved] = cols.splice(from, 1)
      if (!moved) return
      cols.splice(to, 0, moved)
      return ConfigureService.UpdateList(l.ID, l.Label, l.Description, cols, null)
    })
  }

  // fieldFor lifts a render column back to a full Field for the
  // popover -- the authoritative record is re-read in withList at
  // commit time, so only identity and the editable facets matter here.
  const fieldFor = (c: GridColumn): Field => ({
    Key: c.Key, Label: c.Label, Type: (c.Type || 'text') as Field['Type'],
    Required: false, Default: '', Description: '', Options: c.Options,
    Suggestions: null, Secret: false, RefKind: '', Multiline: false, SystemManaged: false,
    deprecated: c.Deprecated ?? false,
  })

  return { error, commitCell, updateRowValues, appendRowsWithValues, insertRowAt, setRowStatus, deleteRow, insertColumnAt, renameColumn, changeColumn, removeColumn, moveColumn, fieldFor, columns }
}
