import type { ReactNode } from 'react'
import { Button } from '@primer/react'
import styles from './UndoToast.module.css'

// The undo toast (goal 0093's pattern, one surface since goal 0270): a
// message and one Undo button. Where it floats is the consumer's
// className -- the Atlas board keeps it inside the board, Configure's
// delete undo pins it to the window -- the look is the same.
export function UndoToast({ message, undoLabel, onUndo, className, testId }: {
  message: ReactNode
  undoLabel: string
  onUndo: () => void
  className?: string
  testId: string
}) {
  return (
    <div className={`${styles.toast} ${className ?? ''}`} data-testid={testId} role="status">
      <span className={styles.message}>{message}</span>
      <Button size="small" variant="invisible" onClick={onUndo} data-testid={`${testId}-button`}>
        {undoLabel}
      </Button>
    </div>
  )
}
