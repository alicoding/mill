import { Panel } from '@xyflow/react'
import { Text } from '@primer/react'
import styles from './CompositionCanvas.module.css'

interface ConnectionRefusalHintProps {
  hint: string | null
}

// The draw-time kind-mismatch explanation (ADR-0042 slice 2), rendered
// as a transient top-right React Flow Panel -- no existing canvas
// notice fit reuse: ExternalChangeBanner is a full-width, dismiss-only
// Primer Banner for an unrelated, non-transient case, and no other
// canvas-scoped toast exists. useConnectionRefusalHint.ts owns the
// auto-clear timing; this component only renders whatever hint it's
// handed.
export function ConnectionRefusalHint({ hint }: ConnectionRefusalHintProps) {
  if (!hint) return null
  return (
    <Panel position="top-right" className={styles.connectionRefusalHint}>
      <Text size="small" data-testid="connection-refusal-hint">{hint}</Text>
    </Panel>
  )
}
