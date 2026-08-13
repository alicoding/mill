import { useTranslation } from 'react-i18next'
import { Text } from '@primer/react'
import { describeCron } from './cronDescribe'
import styles from '../shared/ListCard.module.css'

// Human-readable preview of a trigger-schedule node's cron expression
// (goal 0001 node maturity: the schedule trigger was a raw cron string
// with no confirmation of what it meant). The actual cronstrue call
// lives in cronDescribe.ts's describeCron -- extracted so the
// trigger-aware Workflows-list row label (docs/goals/0006) reuses the
// exact same humanization instead of a second, driftable call site;
// this component only owns the Inspector-shaped presentation around it
// (the <code> wrapping for a shortcut, the muted/error styling).
export function SchedulePreview({ cron }: { cron: string }) {
  const { t } = useTranslation('composition')
  const value = cron.trim()
  if (!value) return null
  const description = describeCron(value)
  if (description.kind === 'invalid') {
    return (
      <Text as="p" size="small" className={styles.error} data-testid="schedule-preview">
        {t('schedulePreview.invalidCron')}
      </Text>
    )
  }
  if (description.kind === 'shortcut') {
    return (
      <Text as="p" size="small" className={styles.muted} data-testid="schedule-preview">
        {t('schedulePreview.scheduleShortcutPrefix')} <code>{description.value}</code>.
      </Text>
    )
  }
  return (
    <Text as="p" size="small" className={styles.muted} data-testid="schedule-preview">
      {description.text}.
    </Text>
  )
}
