import { useTranslation } from 'react-i18next'
import { Button } from '@primer/react'
import styles from './AtlasUndoToast.module.css'

// The quick-delete guard (goal 0093, superseding the old ConfirmDialog
// on every Atlas card/note delete): bottom-center, above the
// selection/creation tray -- AtlasView renders exactly one of these at
// a time, cleared by its own 10s timer, a click, ⌘Z, or a later delete
// finalizing it (useAtlasUndoToast owns that lifecycle; this component
// is pure presentation). linksRemoved/childrenPromoted (goal 0103) name
// the delete's blast radius: a segment appends only when its count is
// non-zero, since undo already restores both in full.
export function AtlasUndoToast({
  count, linksRemoved, childrenPromoted, onUndo,
}: {
  count: number
  linksRemoved: number
  childrenPromoted: number
  onUndo: () => void
}) {
  const { t } = useTranslation('atlas')
  const segments = [t('board.deletedToast', { count })]
  if (linksRemoved > 0) segments.push(t('board.linksHiddenToast', { count: linksRemoved }))
  if (childrenPromoted > 0) segments.push(t('board.childrenMovedToast', { count: childrenPromoted }))
  return (
    <div className={styles.toast} data-testid="atlas-undo-toast" role="status">
      <span className={styles.message}>{segments.join(' ')}</span>
      <Button size="small" variant="invisible" onClick={onUndo} data-testid="atlas-undo-toast-button">
        {t('board.undo')}
      </Button>
    </div>
  )
}
