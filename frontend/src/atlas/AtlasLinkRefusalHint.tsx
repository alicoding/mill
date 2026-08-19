import { Panel } from '@xyflow/react'
import { Text } from '@primer/react'
import styles from './AtlasBoard.module.css'

interface AtlasLinkRefusalHintProps {
  hint: string | null
}

// The drop-time refusal explanation (goal 0124 slice 2), Atlas's own
// instance of the transient top-right React Flow Panel ADR-0042 slice
// 2 established for the workflow canvas -- same visual pattern,
// separate component since the two canvases share no code path.
// useAtlasSlotDrag.ts owns the auto-clear timing; this component only
// renders whatever hint it's handed.
export function AtlasLinkRefusalHint({ hint }: AtlasLinkRefusalHintProps) {
  if (!hint) return null
  return (
    <Panel position="top-right" className={styles.linkRefusalHint}>
      <Text size="small" data-testid="atlas-link-refusal-hint">{hint}</Text>
    </Panel>
  )
}
