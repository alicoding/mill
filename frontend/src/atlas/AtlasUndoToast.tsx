import { useTranslation } from 'react-i18next'
import { UndoToast } from '../shared/UndoToast'
import styles from './AtlasUndoToast.module.css'

// The board's quick-delete toast (goal 0093): the shared UndoToast with
// the board's own message segments and its in-board position.
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
  return <UndoToast className={styles.toast} message={segments.join(' ')} undoLabel={t('board.undo')} onUndo={onUndo} testId="atlas-undo-toast" />
}
