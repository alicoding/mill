import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { UndoToast } from './UndoToast'
import { UNDO_DELETE_TOAST_MS, useUndoDeleteStore } from './undoDeleteStore'
import styles from './UndoDeleteToast.module.css'

// The window-pinned undo toast (goal 0270), mounted once at the app
// root: renders the pending delete's way back for ten seconds. Undo
// dismisses at once; the restore itself is the poster's own promise.
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
  if (!pending) return null
  return (
    <UndoToast
      className={styles.toast}
      message={pending.message}
      undoLabel={t('undoDelete.undo')}
      onUndo={() => { dismiss(pending.key); void pending.undo() }}
      testId="undo-delete-toast"
    />
  )
}
