import cronstrue from 'cronstrue'
import { Text } from '@primer/react'
import styles from '../shared/ListCard.module.css'

// Human-readable preview of a trigger-schedule node's cron expression
// (goal 0001 node maturity: the schedule trigger was a raw cron string
// with no confirmation of what it meant). cronstrue (MIT, zero runtime
// deps -- verified against npm before adopting) describes standard
// 5-field cron; the Go scheduler (netresearch/go-cron) also accepts
// @every/@hourly shortcuts cronstrue does not parse, so those fall
// back to showing the raw value rather than a wrong description.
export function SchedulePreview({ cron }: { cron: string }) {
  const value = cron.trim()
  if (!value) return null
  if (value.startsWith('@')) {
    return (
      <Text as="p" size="small" className={styles.muted} data-testid="schedule-preview">
        Runs on the schedule shortcut <code>{value}</code>.
      </Text>
    )
  }
  let description: string
  try {
    description = cronstrue.toString(value, { verbose: true, throwExceptionOnParseError: true })
  } catch {
    return (
      <Text as="p" size="small" className={styles.error} data-testid="schedule-preview">
        Not a valid cron expression yet.
      </Text>
    )
  }
  return (
    <Text as="p" size="small" className={styles.muted} data-testid="schedule-preview">
      {description}.
    </Text>
  )
}
