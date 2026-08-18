import undoStyles from './AtlasUndoToast.module.css'
import styles from './AtlasQuietToast.module.css'

// Pure presentation for useAtlasQuietToast.ts -- reuses
// AtlasUndoToast.module.css's own floating-pill visual language (same
// bottom-center container, no button) but its own offset so the two
// can never visually collide when both happen to be showing.
export function AtlasQuietToast({ message }: { message: string }) {
  return (
    <div className={`${undoStyles.toast} ${styles.toast}`} data-testid="atlas-quiet-toast" role="status">
      <span className={undoStyles.message}>{message}</span>
    </div>
  )
}
