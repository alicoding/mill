import { useTranslation } from 'react-i18next'
import { Button, Link, Stack, Text } from '@primer/react'
import { LockIcon } from '@primer/octicons-react'
import type { RunSummary } from '../shared/bindings'
import { StatusStamp } from '../shared/StatusStamp'
import { StalenessBadge } from '../shared/StalenessBadge'
import { VaultWaitActions } from '../shared/VaultWaitActions'
import { commandLabel, findCommand } from '../shared/commands'
import type { CommandContext } from '../shared/commandContext'
import styles from '../shared/ListCard.module.css'
import mobileStyles from './ReviewView.module.css'

// A run waiting for the vault (goal 0360 S2), in the Review queue: the
// same card family as an approval ask -- workflow name, badge, age,
// step -- but the ask is "unlock the vault", not a decision about the
// step, so the actions are Unlock vault and Stop run.
export function ReviewVaultWaitCard({ run, onOpen }: { run: RunSummary; onOpen: () => void }) {
  const { t } = useTranslation('views')
  const { t: tc } = useTranslation('common')
  const ctx: CommandContext = { kind: 'run', runId: run.runID, workflowId: run.workflowID, nodeId: run.pending?.nodeID }
  return (
    <div
      className={`${styles.card} ${styles.activityRowClickable}`}
      data-testid="review-vault-wait-item"
      onClick={onOpen}
    >
      <Stack direction="vertical" gap="condensed">
        <Stack direction="horizontal" gap="condensed" align="center">
          <LockIcon size={16} />
          <Link
            as="button"
            type="button"
            className={mobileStyles.workflowLink}
            onClick={(e) => { e.stopPropagation(); onOpen() }}
            data-testid="review-item-workflow"
          >
            {run.workflowLabel}
          </Link>
          <StatusStamp variant="caution" data-testid="review-vault-wait-badge">{tc('vaultWait.badge')}</StatusStamp>
          <StalenessBadge createdAt={run.startedAt} testId="review-item-age" />
        </Stack>
        <Text weight="semibold" data-testid="review-vault-wait-title">{tc('vaultWait.title')}</Text>
        <Text size="small">{tc('vaultWait.body')}</Text>
        <Text size="small">
          {t('reviewView.stepPrefix')} <Text weight="semibold">{run.pending?.nodeTypeLabel || run.pending?.nodeTypeID}</Text>
        </Text>
        <Stack direction="horizontal" gap="condensed" className={mobileStyles.approvalActions} onClick={(e) => e.stopPropagation()}>
          <VaultWaitActions ctx={ctx} testIdPrefix="review-vault-wait" />
          <Button size="small" variant="invisible" data-testid="review-open-run" onClick={onOpen}>
            {commandLabel(findCommand('run.open')!)}
          </Button>
        </Stack>
      </Stack>
    </div>
  )
}
