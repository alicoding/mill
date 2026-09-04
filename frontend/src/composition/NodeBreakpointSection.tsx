import { useTranslation } from 'react-i18next'
import { Button, Stack, Text } from '@primer/react'
import { BugIcon } from '@primer/octicons-react'
import { StatusStamp } from '../shared/StatusStamp'
import { useNodeBreakpoint } from './breakpoints'
import styles from '../shared/ListCard.module.css'

// Tier 2's Breakpoint group (goal 0327). A breakpoint borrows the
// guardrail Rule/park plumbing without being policy -- exactly one
// instance-scoped Source:debug rule for this node (docs/adr/0031 item
// 1) -- so it reads and writes the same shared BreakpointContext
// (breakpoints.ts) the node card's own dot uses, never its own fetch.
//
// The card's dot stays the primary control; this toggle is the same
// command reached from the panel that shows the state, so a user who
// found the state here can act on it without hunting back to the card.
export function NodeBreakpointSection({ nodeId }: { nodeId: string }) {
  const { t } = useTranslation('composition')
  const breakpoint = useNodeBreakpoint(nodeId)
  return (
    <Stack direction="vertical" gap="condensed" data-testid="node-breakpoint-section">
      <Text size="small" weight="semibold">{t('nodeInspector.breakpointHeading')}</Text>
      <Stack direction="horizontal" gap="condensed" align="center">
        <BugIcon size={16} fill={breakpoint.isSet ? 'var(--fgColor-accent)' : 'var(--fgColor-muted)'} />
        <Text size="small" data-testid="breakpoint-status">
          {breakpoint.isSet ? t('nodeGuardrailSection.breakpointSet') : t('nodeGuardrailSection.noBreakpoint')}
        </Text>
        {breakpoint.isSet && (
          <StatusStamp variant="identity" data-testid="breakpoint-badge">{t('nodeGuardrailSection.breakpointBadge')}</StatusStamp>
        )}
      </Stack>
      <Text size="small" className={styles.muted}>
        {t('nodeGuardrailSection.breakpointDescription')}
      </Text>
      <Stack direction="horizontal">
        <Button
          size="small"
          data-testid="inspector-breakpoint-toggle"
          disabled={!breakpoint.enabled || breakpoint.busy}
          onClick={() => breakpoint.toggle()}
        >
          {breakpoint.isSet ? t('nodeInspector.removeBreakpoint') : t('nodeInspector.addBreakpoint')}
        </Button>
      </Stack>
      {!breakpoint.enabled && (
        <Text size="small" className={styles.muted}>{t('nodeInspector.breakpointSaveFirst')}</Text>
      )}
    </Stack>
  )
}
