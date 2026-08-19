import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Events } from '@wailsio/runtime'
import { Button, Text, TextInput } from '@primer/react'
import { AtlasService, ConfigureService } from '../shared/bindings'
import type { ListProjection } from '../../bindings/github.com/alicoding/mill/internal/services/atlassvc/models'
import { type Field, Type as FieldType } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'
import { RowStatus } from '../../bindings/github.com/alicoding/mill/internal/domain/list/models'
import { nextColumnKey } from './projectionColumns'
import styles from './AtlasCardProjectionTable.module.css'

// The projected List rendered as a table (goal 0105): used by the
// board's table node AND the card page -- one definition, so both
// surfaces always agree. Live (re-fetched on every persisted List
// change) and editable IN PLACE with the boundary-insert pattern the
// owner pointed at (Confluence/eraser's solved shape): hover a column
// header and a ⊕ appears at its right edge inserting THERE; hover a
// row and a ⊕ at its lower-left inserts right below; headers rename
// on click; cells edit on click; end buttons append as the
// discoverable fallback. Every edit commits through the List's own
// ConfigureService methods -- the SAME ungated direct-edit path
// Configure's editor uses (the guardrail gate governs workflow/agent
// side effects, never the user's own direct edits) -- and every other
// projection of the List updates through the same data event.
export function AtlasCardProjectionTable({ cardID }: { cardID: string }) {
  const { t } = useTranslation('atlas')
  const [proj, setProj] = useState<ListProjection | null>(null)
  const [editing, setEditing] = useState<{ rowID: string; key: string; value: string } | null>(null)
  const [renaming, setRenaming] = useState<{ key: string; label: string } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const refetch = () => void AtlasService.CardListProjection(cardID).then(setProj).catch(() => setProj(null))
    refetch()
    return Events.On('mill-data-changed', (evt) => {
      const entity = (evt.data as { entity?: string })?.entity
      if (entity === 'list' || entity === 'atlas') refetch()
    })
  }, [cardID])

  if (!proj || proj.ListID === '') return null
  if (proj.Missing) {
    return (
      <Text as="p" size="small" className={styles.missing} data-testid="atlas-projection-missing">
        {t('projection.missingList')}
      </Text>
    )
  }
  const columns = proj.Columns ?? []
  const rows = proj.Rows ?? []
  const report = (err: unknown) => setError(String(err))
  const clearThen = () => setError('')

  const commitCell = () => {
    if (!editing) return
    const row = rows.find((r) => r?.ID === editing.rowID)
    const edit = editing
    setEditing(null)
    if (!row) return
    const values = { ...(row.Values ?? {}), [edit.key]: edit.value }
    ConfigureService.UpdateListRow(proj.ListID, row.ID, values, (row.Status || 'active') as RowStatus)
      .then(clearThen).catch(report)
  }

  const insertRowAt = (index: number) => {
    ConfigureService.AddListRowAt(proj.ListID, {}, index).then(clearThen).catch(report)
  }

  // withList runs fn against the projected List's CURRENT full record
  // (UpdateList replaces the whole columns slice, so inserts/renames
  // need label+description+columns as they stand right now).
  const withList = (fn: (l: { ID: string; Label: string; Description: string; Columns: Field[] | null }) => Promise<unknown> | undefined) => {
    void ConfigureService.Lists().then((lists) => {
      const l = (lists ?? []).find((x) => x.ID === proj.ListID)
      if (!l) return
      return fn(l)
    }).then(clearThen).catch(report)
  }

  const insertColumnAt = (index: number) => {
    withList((l) => {
      const cols = l.Columns ?? []
      const key = nextColumnKey(t('projection.newColumnLabel'), cols.map((c) => c.Key))
      const newColumn: Field = {
        Key: key, Label: t('projection.newColumnLabel'), Type: FieldType.TypeText,
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

  const commitRename = () => {
    if (!renaming) return
    const rename = renaming
    setRenaming(null)
    if (!rename.label.trim()) return
    withList((l) => {
      const next = (l.Columns ?? []).map((c) => (c.Key === rename.key ? { ...c, Label: rename.label.trim() } : c))
      return ConfigureService.UpdateList(l.ID, l.Label, l.Description, next, null)
    })
  }

  return (
    // nowheel/nodrag: the table scrolls and its inputs receive clicks
    // without zooming or dragging the canvas underneath (React Flow's
    // own utility classes; nodrag on the container covers children).
    <div className={`${styles.wrap} nowheel nodrag`} data-testid="atlas-projection-table">
      <div className={styles.scroll}>
        {columns.length === 0 ? (
          <Text as="p" size="small" className={styles.empty}>{t('projection.noColumns')}</Text>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                {columns.map((c, colIdx) => (
                  <th key={c.Key} data-testid="atlas-projection-header">
                    {renaming?.key === c.Key ? (
                      <TextInput
                        autoFocus size="small" value={renaming.label}
                        aria-label={t('projection.renameColumnAriaLabel')}
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
                        title={t('projection.renameColumnTitle')}
                        onClick={() => setRenaming({ key: c.Key, label: c.Label || c.Key })}
                      >
                        {c.Label || c.Key}
                      </button>
                    )}
                    <button
                      type="button"
                      className={`${styles.insertDot} ${styles.insertDotColumn}`}
                      aria-label={t('projection.insertColumnAriaLabel')}
                      title={t('projection.insertColumnAriaLabel')}
                      data-testid="atlas-projection-insert-column"
                      onClick={() => insertColumnAt(colIdx + 1)}
                    >
                      +
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIdx) => row && (
                <tr key={row.ID} data-testid="atlas-projection-row">
                  {columns.map((c, colIdx) => (
                    <td
                      key={c.Key}
                      data-testid="atlas-projection-cell"
                      onClick={() => setEditing({ rowID: row.ID, key: c.Key, value: row.Values?.[c.Key] ?? '' })}
                    >
                      {editing && editing.rowID === row.ID && editing.key === c.Key ? (
                        <TextInput
                          autoFocus size="small" value={editing.value}
                          aria-label={c.Label || c.Key}
                          data-testid="atlas-projection-cell-input"
                          onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                          onBlur={commitCell}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitCell()
                            if (e.key === 'Escape') setEditing(null)
                          }}
                        />
                      ) : (
                        row.Values?.[c.Key] ?? ''
                      )}
                      {colIdx === 0 && (
                        <button
                          type="button"
                          className={`${styles.insertDot} ${styles.insertDotRow}`}
                          aria-label={t('projection.insertRowAriaLabel')}
                          title={t('projection.insertRowAriaLabel')}
                          data-testid="atlas-projection-insert-row"
                          onClick={(e) => { e.stopPropagation(); insertRowAt(rowIdx + 1) }}
                        >
                          +
                        </button>
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
            {t('projection.addRow')}
          </Button>
        )}
        <Button size="small" variant="invisible" data-testid="atlas-projection-add-column" onClick={() => insertColumnAt(columns.length)}>
          {t('projection.addColumn')}
        </Button>
      </div>
      {error && <Text as="p" size="small" className={styles.missing} data-testid="atlas-projection-error">{error}</Text>}
    </div>
  )
}
