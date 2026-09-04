import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Text } from '@primer/react'
import { AtlasService, ConfigureService } from '../shared/bindings'
import { useUISignalStore } from '../shared/uiSignalStore'
import { refreshAtlas } from './atlasStore'
import styles from './AtlasTableTitleRow.module.css'

// A table object's own name, above its grid (goal 0273): the converged
// canvas-table affordance -- a title over the sheet, renamed by direct
// manipulation on the title itself (double-click), or from the
// object's context menu. The backing List's Label is the single source
// of truth, so renaming here renames the table everywhere it projects;
// BoardObject.Payload.title is written in the same commit because the
// jump and contents surfaces read a board object's name from there
// (atlasJumpFilter.ts's own objectJumpLabel).
//
// The commit is Configure's own door -- the same GetList + UpdateList
// round trip shared/useListSchemaEdits.ts uses for every schema edit --
// never a second write path, and never an undo journal of its own
// (ADR-0044: one actor-scoped journal, and the List write is
// Configure's).
export function AtlasTableTitleRow({ objectID, listID, label }: { objectID: string; listID: string; label: string }) {
  const { t } = useTranslation('atlas')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(label)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  // The edit session, held in a ref rather than read back off `editing`:
  // Enter commits and unmounts the input in the same tick, and a blur
  // arriving behind it would otherwise re-run the same write off a
  // closure that still believes the session is open.
  const openRef = useRef(false)

  const beginEdit = () => {
    openRef.current = true
    setDraft(label)
    setEditing(true)
  }

  // An empty or whitespace-only name commits nothing -- a table always
  // has a name, so the previous one stands rather than the object
  // losing its title.
  const endEdit = (keep: boolean) => {
    if (!openRef.current) return
    openRef.current = false
    setEditing(false)
    const next = draft.trim()
    if (!keep || !next || next === label) return
    ConfigureService.GetList(listID)
      .then((l) => ConfigureService.UpdateList(l.ID, next, l.Description, l.Columns, null))
      .then(() => AtlasService.SetBoardObjectPayload(objectID, { title: next }))
      .then(() => { setError(''); return refreshAtlas() })
      .catch((err) => setError(String(err)))
  }

  // The context menu's Rename (goal 0273): a token-carrying signal, the
  // same ref-compared shape every other atlas request counter takes --
  // only the row whose own object was right-clicked enters edit.
  const request = useUISignalStore((s) => s.atlasTableRenameRequest)
  const lastSeq = useRef(request?.seq ?? 0)
  useEffect(() => {
    const seq = request?.seq ?? 0
    if (seq === lastSeq.current) return
    lastSeq.current = seq
    if (request?.id !== objectID) return
    openRef.current = true
    setDraft(label)
    setEditing(true)
  }, [request, objectID, label])

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  return (
    <>
      <div
        className={editing ? `${styles.titleRow} nodrag nopan nowheel` : `${styles.titleRow} nodrag`}
        data-testid="atlas-table-title"
        onDoubleClick={editing ? undefined : beginEdit}
      >
        {editing ? (
          <input
            ref={inputRef}
            autoFocus
            className={styles.input}
            data-testid="atlas-table-title-input"
            aria-label={t('table.titleAriaLabel')}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => endEdit(true)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') endEdit(true)
              if (e.key === 'Escape') endEdit(false)
            }}
          />
        ) : (
          <Text size="small" weight="semibold" className={styles.label} title={label}>{label}</Text>
        )}
      </div>
      {error && <p className={styles.error} data-testid="atlas-table-title-error">{error}</p>}
    </>
  )
}
