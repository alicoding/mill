import { useTranslation } from 'react-i18next'
import { Button } from '@primer/react'
import styles from './AtlasUndoToast.module.css'

// The quick-delete guard (goal 0093, superseding the old ConfirmDialog
// on every Atlas card/note delete): bottom-center, above the
// selection/creation tray -- AtlasView renders exactly one of these at
// a time, cleared by its own 10s timer, a click, ⌘Z, or a later delete
// finalizing it (useAtlasUndoToast owns that lifecycle; this component
// is pure presentation).
export function AtlasUndoToast({ count, onUndo }: { count: number; onUndo: () => void }) {
  const { t } = useTranslation('atlas')
  return (
    <div className={styles.toast} data-testid="atlas-undo-toast" role="status">
      <span className={styles.message}>{t('board.deletedToast', { count })}</span>
      <Button size="small" variant="invisible" onClick={onUndo} data-testid="atlas-undo-toast-button">
        {t('board.undo')}
      </Button>
    </div>
  )
}
