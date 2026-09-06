import { useTranslation } from 'react-i18next'
import { Stack, Text } from '@primer/react'
import { LockIcon } from '@primer/octicons-react'
import type { PendingApproval } from '../shared/bindings'
import { VaultWaitActions } from '../shared/VaultWaitActions'
import type { CommandContext } from '../shared/commandContext'
import styles from '../shared/ListCard.module.css'

// The Runs tab's banner for a run waiting on the vault (goal 0360 S2)
// -- the sibling of the approval banner, with the unlock ask in place
// of a decision.
export function VaultWaitBanner({ pending, runID, workflowID }: { pending: PendingApproval; runID: string; workflowID?: string }) {
  const { t } = useTranslation('composition')
  const { t: tc } = useTranslation('common')
  const ctx: CommandContext = { kind: 'run', runId: runID, workflowId: workflowID, nodeId: pending.nodeID }
  return (
    <div className={styles.card} data-testid="vault-wait-banner" style={{ marginTop: 'var(--base-size-12)' }}>
      <Stack direction="vertical" gap="condensed">
        <Stack direction="horizontal" gap="condensed" align="center">
          <LockIcon size={16} fill="var(--fgColor-attention)" />
          <Text weight="semibold" data-testid="vault-wait-banner-heading">{tc('vaultWait.title')}</Text>
        </Stack>
        <Text size="small">{tc('vaultWait.body')}</Text>
        <Text size="small">
          {t('workflowRunsPanel.theStepPrefix')} <Text weight="semibold">{pending.nodeTypeLabel || pending.nodeTypeID}</Text>
        </Text>
        <VaultWaitActions ctx={ctx} testIdPrefix="vault-wait" />
      </Stack>
    </div>
  )
}
