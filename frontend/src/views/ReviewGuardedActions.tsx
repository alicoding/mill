import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Stack, Text } from '@primer/react'
import { ShieldIcon } from '@primer/octicons-react'
import { Events } from '@wailsio/runtime'
import { GuardrailService } from '../../bindings/github.com/alicoding/mill/internal/services/guardrailsvc'
import type { PendingGuardedAction } from '../../bindings/github.com/alicoding/mill/internal/services/guardrailsvc/models'
import { StatusStamp } from '../shared/StatusStamp'
import { StalenessBadge } from '../shared/StalenessBadge'
import styles from './ReviewView.module.css'

// Pending guarded actions in the Review queue (docs/goals/0249,
// closing docs/adr/0047 §5's render-alongside half): a non-workflow
// caller -- a plugin, an agent -- asked the guardrail for an action
// and a rule (or ClassExternal's ask-by-default) parked it. Same
// approve/deny decision pair as every other queue row; the blocked
// caller wakes with the answer. Self-contained data-wise (its own
// fetch + the same pending-changed event the run queue refreshes on)
// so ReviewView stays a thin composition of queue sections.
// onCount reports how many actions are parked so the queue's blankslate
// (ReviewView.tsx) can stay away while a guarded action is live -- it
// used to render "Nothing waiting for you" above a live row.
export function ReviewGuardedActions({ visible, onCount }: { visible: boolean; onCount?: (count: number) => void }) {
	const { t } = useTranslation('views')
	const [actions, setActions] = useState<PendingGuardedAction[]>([])
	useEffect(() => { onCount?.(actions.length) }, [actions.length, onCount])

	const refresh = () => {
		GuardrailService.PendingGuardedActions().then((a) => setActions(a ?? [])).catch(() => {})
	}
	useEffect(() => {
		refresh()
		const off = Events.On('guardrail-pending-changed', refresh)
		const timer = window.setInterval(refresh, 2000)
		return () => {
			off()
			window.clearInterval(timer)
		}
	}, [])

	const resolve = (id: string, approve: boolean) => {
		GuardrailService.ResolveGuardedAction(id, approve).then(refresh).catch(() => {})
	}

	if (!visible || actions.length === 0) return null
	return (
		<Stack direction="vertical" gap="normal">
			{actions.map((a) => (
				<div key={a.ID} className={styles.card} data-testid="review-guarded-action-item" data-guarded-action-id={a.ID}>
					<Stack direction="vertical" gap="condensed">
						<Stack direction="horizontal" gap="condensed" align="center">
							<ShieldIcon size={16} />
							<Text weight="semibold">{t('reviewView.guardedActionRequest')}</Text>
							<StatusStamp variant="caution">{t('reviewView.awaitingApprovalLower')}</StatusStamp>
							<StalenessBadge createdAt={a.CreatedAt} testId="review-guarded-action-age" />
						</Stack>
						<Text size="small">{a.Description || a.Kind}</Text>
						<Text size="small" className={styles.muted} data-testid="review-guarded-action-source">
							{t('reviewView.guardedActionSource', { source: a.Source, kind: a.Kind })}
						</Text>
						<Stack direction="horizontal" gap="condensed" className={styles.approvalActions}>
							<Button size="small" variant="primary" data-testid="review-guarded-action-approve" onClick={() => resolve(a.ID, true)}>
								{t('reviewView.approve')}
							</Button>
							<Button size="small" variant="danger" data-testid="review-guarded-action-deny" onClick={() => resolve(a.ID, false)}>
								{t('reviewView.deny')}
							</Button>
						</Stack>
					</Stack>
				</div>
			))}
		</Stack>
	)
}
