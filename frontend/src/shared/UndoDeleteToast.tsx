import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { UndoToast } from './UndoToast'
import { UNDO_DELETE_TOAST_MS, useUndoDeleteStore } from './undoDeleteStore'
import { useUISignalStore } from './uiSignalStore'
import styles from './UndoDeleteToast.module.css'

// The window-pinned undo toast (goal 0270), mounted once at the app
// root: renders the pending delete's (one row's, or since goal 0404 S1
// a bulk selection's) way back for ten seconds. Undo dismisses at
// once; the restore itself is the poster's own promise. The toast is
// an affordance over the journal (ADR-0044 amendment): it hides once
// the journal's top step is no longer the delete it offers -- the
// delete was ⌘Z'd, or a newer step landed on top of it. The matchedRef
// latch keeps the toast visible until the first journal poll has
// caught up, so the toast never flashes out before its own delete has
// been observed as the top step (goal 0352 part 2). A pending entry
// with no `undo` (Secrets' bulk delete, which registers nothing) skips
// the journal watch entirely -- it just runs its own fixed timer.
export function UndoDeleteToast() {
  const { t } = useTranslation('common')
  const pending = useUndoDeleteStore((s) => s.pending)
  const dismiss = useUndoDeleteStore((s) => s.dismiss)
  const key = pending?.key
  useEffect(() => {
    if (!key) return
    const timer = window.setTimeout(() => dismiss(key), UNDO_DELETE_TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [key, dismiss])

  const top = useUISignalStore((s) => s.atlasUndoTop)
  const matchedRef = useRef(false)
  useEffect(() => {
    matchedRef.current = false
  }, [key])
  useEffect(() => {
    if (!key || !pending?.undo) return
    if (top && top.kind === pending.journalKind && top.id === pending.journalId) {
      matchedRef.current = true
      return
    }
    if (matchedRef.current) dismiss(key)
  }, [key, pending?.undo, pending?.journalKind, pending?.journalId, top, dismiss])

  if (!pending) return null
  const undo = pending.undo
  return undo ? (
    <UndoToast
      className={styles.toast}
      message={pending.message}
      testId="undo-delete-toast"
      undoLabel={t('undoDelete.undo')}
      onUndo={() => { dismiss(pending.key); void undo() }}
    />
  ) : (
    <UndoToast className={styles.toast} message={pending.message} testId="undo-delete-toast" />
  )
}
