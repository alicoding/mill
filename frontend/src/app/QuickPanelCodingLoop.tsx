import { CodingLoopSurface } from '../shared/CodingLoopSurface'
import styles from './QuickPanel.module.css'

interface Props {
  clipboardText: string
  onClose: () => void
}

// The coding loop's Quick Panel door body (docs/goals/0240 S1): swaps
// the ENTIRE panel body into CodingLoopSurface, same full-replacement
// shape QuickPanel.tsx's own clipboardApply/replyReview doors already
// use (ADR-0033's frameless floating window has no room for a second,
// nested surface) -- split into its own file purely to keep
// QuickPanel.tsx's own body-swap block under CLAUDE.md's 500-line
// convention, not a different pattern from those two.
export function QuickPanelCodingLoop({ clipboardText, onClose }: Props) {
  return (
    <div className={styles.panel} data-testid="quick-panel">
      <CodingLoopSurface clipboardText={clipboardText} onClose={onClose} />
    </div>
  )
}
