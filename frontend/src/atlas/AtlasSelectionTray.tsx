import { forwardRef } from 'react'
import { useTranslation } from 'react-i18next'
import { SquareIcon, TrashIcon } from '@primer/octicons-react'
import styles from './AtlasSelectionTray.module.css'

// Same non-copy kbd-glyph shape AtlasCreationTray.tsx's own TOOL_KEY
// uses -- a keycap label, not translatable UI copy.
const DELETE_KBD = '⌫'
const CLEAR_KBD = 'esc'

// The floating tray a live multi-selection replaces the creation tray
// with (owner-caught follow-up to goal 0092): same bottom-center
// position/container the creation tray occupies -- AtlasBoard renders
// exactly one of the two, never both. Group shows for ANY 2+
// selected things -- cards, notes, and board objects all group (goal
// 0266's peer law, matching the multi-select context menu and
// bare-G).
export const AtlasSelectionTray = forwardRef<HTMLDivElement, {
  selectedCardCount: number
  selectedNoteCount: number
  // Board objects: full Group peers (goal 0266), and part of the
  // total and Delete like notes.
  selectedObjectCount: number
  onGroup: (pos: { x: number; y: number }) => void
  onDelete: () => void
}>(function AtlasSelectionTray({ selectedCardCount, selectedNoteCount, selectedObjectCount, onGroup, onDelete }, ref) {
  const { t } = useTranslation('atlas')
  const count = selectedCardCount + selectedNoteCount + selectedObjectCount

  return (
    <div ref={ref} className={styles.tray} data-testid="atlas-selection-tray" role="toolbar" aria-label={t('board.selectionTrayAriaLabel')}>
      <span className={styles.count} data-testid="atlas-selection-count">{t('board.selectionCount', { count })}</span>
      <span className={styles.divider} aria-hidden="true" />
      {count >= 2 && (
        <button
          type="button"
          className={styles.action}
          data-testid="atlas-selection-group"
          onClick={(e) => onGroup({ x: e.clientX, y: e.clientY })}
        >
          <SquareIcon size={14} />
          <span className={styles.label}>{t('board.selectionGroup')}</span>
          <span className={styles.kbd}>G</span>
        </button>
      )}
      <button type="button" className={styles.action} data-testid="atlas-selection-delete" onClick={onDelete}>
        <TrashIcon size={14} />
        <span className={styles.label}>{t('board.selectionDelete')}</span>
        <span className={styles.kbd}>{DELETE_KBD}</span>
      </button>
      <span className={styles.hint}>
        <span className={styles.kbd}>{CLEAR_KBD}</span>
        {t('board.selectionClearHint')}
      </span>
    </div>
  )
})
