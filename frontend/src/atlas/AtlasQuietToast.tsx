import { Button } from '@primer/react'
import undoStyles from './AtlasUndoToast.module.css'
import styles from './AtlasQuietToast.module.css'

// Pure presentation for useAtlasQuietToast.ts -- reuses
// AtlasUndoToast.module.css's own floating-pill visual language (same
// bottom-center container, no button) but its own offset so the two
// can never visually collide when both happen to be showing.
export function AtlasQuietToast({ message, action }: { message: string; action?: { label: string; run: () => void } | null }) {
  return (
    <div className={`${undoStyles.toast} ${styles.toast}`} data-testid="atlas-quiet-toast" role="status">
      <span className={undoStyles.message}>{message}</span>
      {action && (
        <Button size="small" variant="invisible" data-testid="atlas-quiet-toast-action" onClick={action.run}>
          {action.label}
        </Button>
      )}
    </div>
  )
}
