import { useState } from 'react'
import { Heading, Label, type LabelProps, Select, Stack, Text } from '@primer/react'
import { ChevronDownIcon, ChevronRightIcon, CheckCircleIcon, XCircleIcon } from '@primer/octicons-react'
import { useAppStore, type ActivitySource } from './store'
import styles from './RunbookView.module.css'

const SOURCE_LABEL: Record<ActivitySource, string> = {
  hotkey: 'Hotkey',
  runbook: 'Runbook',
  composition: 'Composition',
}

const SOURCE_VARIANT: Record<ActivitySource, LabelProps['variant']> = {
  hotkey: 'severe',
  runbook: 'accent',
  composition: 'success',
}

type OutcomeFilter = 'all' | 'success' | 'failed'

// A dedicated, always-visible page rather than a section tucked inside
// Runbook: a hotkey fires headlessly with no other UI surface (§2.2), so
// this is the only way to see whether anything fired at all — nested
// inside another page, it was indistinguishable from "the feed doesn't
// work" when nothing had fired yet. Subscribed once at App.tsx (not here)
// so it keeps collecting even while this tab isn't the active view.
// Not hotkey-only: every run pushes here regardless of how it was
// triggered (hotkey fire, or a direct Run click on Runbook/Composition)
// — one shared feed for "did anything run," not three separate ones.
function ActivityView() {
  const activity = useAppStore((s) => s.activity)
  // Which rows are expanded to show their full result. A Set, not a
  // single id, since comparing two past fires side by side is a
  // reasonable thing to want in a log view.
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [sourceFilter, setSourceFilter] = useState<'all' | ActivitySource>('all')
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>('all')

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const filtered = activity.filter((entry) => {
    if (sourceFilter !== 'all' && entry.source !== sourceFilter) return false
    if (outcomeFilter === 'success' && !entry.success) return false
    if (outcomeFilter === 'failed' && entry.success) return false
    return true
  })
  const filtersActive = sourceFilter !== 'all' || outcomeFilter !== 'all'

  return (
    <div className={styles.runbook}>
      <Heading as="h1">Activity</Heading>
      <Text as="p" className={styles.subtitle}>
        What ran, whether triggered by a hotkey or a direct Run click on
        Runbook or Composition — a hotkey fires headlessly and writes
        straight to the clipboard with no other feedback, so this is the
        only place to see it happened at all. Session-only: this list
        isn&apos;t persisted across restarts.
      </Text>

      {activity.length > 0 && (
        <Stack direction="horizontal" gap="condensed" className={styles.filterRow}>
          <Select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as 'all' | ActivitySource)} aria-label="Filter by source">
            <Select.Option value="all">All sources</Select.Option>
            <Select.Option value="hotkey">Hotkey</Select.Option>
            <Select.Option value="runbook">Runbook</Select.Option>
            <Select.Option value="composition">Composition</Select.Option>
          </Select>
          <Select value={outcomeFilter} onChange={(e) => setOutcomeFilter(e.target.value as OutcomeFilter)} aria-label="Filter by outcome">
            <Select.Option value="all">All outcomes</Select.Option>
            <Select.Option value="success">Success</Select.Option>
            <Select.Option value="failed">Failed</Select.Option>
          </Select>
        </Stack>
      )}

      {activity.length === 0 && (
        <div className={styles.empty}>
          <Text as="p">No activity yet — run something on Runbook or Composition, or press a bound hotkey, to see it appear here.</Text>
        </div>
      )}

      {activity.length > 0 && filtered.length === 0 && (
        <div className={styles.empty}>
          <Text as="p">No activity matches this filter.</Text>
        </div>
      )}

      {filtered.length > 0 && (
        <Stack direction="vertical" gap="condensed">
          {filtered.map((entry) => {
            const canExpand = entry.result !== ''
            const isExpanded = expanded.has(entry.id)
            return (
              <div key={entry.id} className={styles.activityEntry} data-testid="activity-row">
                <Stack
                  direction="horizontal"
                  align="center"
                  gap="condensed"
                  className={`${styles.activityRow}${canExpand ? ` ${styles.activityRowClickable}` : ''}`}
                  onClick={canExpand ? () => toggle(entry.id) : undefined}
                >
                  {canExpand ? (
                    isExpanded ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />
                  ) : (
                    <span className={styles.activitySpacer} />
                  )}
                  {entry.success ? (
                    <CheckCircleIcon size={16} fill="var(--fgColor-success)" />
                  ) : (
                    <XCircleIcon size={16} fill="var(--fgColor-danger)" />
                  )}
                  <Text size="small" className={styles.muted}>{entry.time}</Text>
                  <Label variant={SOURCE_VARIANT[entry.source]} size="small">{SOURCE_LABEL[entry.source]}</Label>
                  {entry.binding && <Label variant="secondary" size="small">{entry.binding}</Label>}
                  <Text size="small">{entry.label}</Text>
                  <Text size="small" className={styles.muted}>— {entry.detail}</Text>
                </Stack>
                {isExpanded && canExpand && (
                  <pre className={styles.result}>{entry.result}</pre>
                )}
              </div>
            )
          })}
        </Stack>
      )}
      {filtersActive && filtered.length > 0 && (
        <Text as="p" size="small" className={styles.muted}>
          Showing {filtered.length} of {activity.length}.
        </Text>
      )}
    </div>
  )
}

export default ActivityView
