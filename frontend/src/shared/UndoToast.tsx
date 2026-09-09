import type { ReactNode } from 'react'
import { Button } from '@primer/react'
import styles from './UndoToast.module.css'

// The undo toast (goal 0093's pattern, one surface since goal 0270): a
// message and, usually, one Undo button. Where it floats is the
// consumer's className -- the Atlas board keeps it inside the board,
// Configure's delete undo pins it to the window -- the look is the
// same. `undoLabel`/`onUndo` are omitted TOGETHER for an outcome whose
// door registers no way back (a bulk Secrets delete, goal 0404 S1's
// amendment) -- a button that would always fail is worse than none.
export function UndoToast({ message, undoLabel, onUndo, className, testId }: {
  message: ReactNode
  className?: string
  testId: string
} & ({ undoLabel: string; onUndo: () => void } | { undoLabel?: undefined; onUndo?: undefined })) {
  return (
    <div className={`${styles.toast} ${className ?? ''}`} data-testid={testId} role="status">
      <span className={styles.message}>{message}</span>
      {onUndo && (
        <Button size="small" variant="invisible" onClick={onUndo} data-testid={`${testId}-button`}>
          {undoLabel}
        </Button>
      )}
    </div>
  )
}
