import { useState } from 'react'
import { Heading, IconButton, Label, type LabelProps, Select, Stack, Text } from '@primer/react'
import { DataTable, type Column } from '@primer/react/experimental'
import { ChevronDownIcon, ChevronRightIcon, CheckCircleIcon, XCircleIcon, XIcon } from '@primer/octicons-react'
import { useAppStore, type ActivityEntry, type ActivitySource } from '../shared/store'
import styles from '../shared/ListCard.module.css'

const SOURCE_LABEL: Record<ActivitySource, string> = {
  trigger: 'Trigger',
  composition: 'Composition',
}

const SOURCE_VARIANT: Record<ActivitySource, LabelProps['variant']> = {
  trigger: 'severe',
  composition: 'success',
}

type OutcomeFilter = 'all' | 'success' | 'failed'

// A dedicated, always-visible page: a headless trigger (hotkey, schedule,
// clipboard-watch, filesystem-watch -- docs/SPEC.md §3.4) fires with no
// other UI surface, so this is the only way to see whether anything
// fired at all — nested inside another page, it was indistinguishable
// from "the feed doesn't work" when nothing had fired yet. Subscribed
// once at App.tsx (not here) so it keeps collecting even while this tab
// isn't the active view. Not trigger-only: every run pushes here
// regardless of how it was triggered (a headless fire, or a direct Run
// click on Composition) — one shared feed for "did anything run," not
// two separate ones.
//
// Renders as Primer's DataTable (@primer/react/experimental) rather than
// the hand-rolled expand-list this used to be — DataTable has no generic
// row-click/expand affordance, so "click a row to see its full result"
// moves from per-row inline expansion to a click on the Action cell that
// toggles a detail panel below the table. The comparison feature this
// used to have (multiple rows expanded at once, to compare two fires
// side by side) is deliberately preserved, not dropped: selectedIds
// stays a Set, and one panel renders per selected entry.
function ActivityView() {
  const activity = useAppStore((s) => s.activity)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [sourceFilter, setSourceFilter] = useState<'all' | ActivitySource>('all')
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>('all')

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
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
  const selectedEntries = filtered.filter((entry) => selectedIds.has(entry.id) && entry.result !== '')

  const columns: Column<ActivityEntry>[] = [
    {
      id: 'time',
      header: 'Time',
      field: 'timestamp',
      sortBy: 'basic',
      width: '120px',
      renderCell: (entry) => <Text size="small" className={styles.muted}>{entry.time}</Text>,
    },
    {
      id: 'source',
      header: 'Source',
      field: 'source',
      sortBy: 'alphanumeric',
      renderCell: (entry) => (
        <Stack direction="horizontal" gap="condensed" align="center">
          <Label variant={SOURCE_VARIANT[entry.source]} size="small">{SOURCE_LABEL[entry.source]}</Label>
          {entry.binding && <Label variant="secondary" size="small">{entry.binding}</Label>}
        </Stack>
      ),
    },
    {
      id: 'action',
      header: 'Action',
      width: 'grow',
      renderCell: (entry) => {
        const canExpand = entry.result !== ''
        const isSelected = selectedIds.has(entry.id)
        return (
          <Stack
            direction="horizontal"
            gap="condensed"
            align="center"
            className={canExpand ? styles.activityRowClickable : undefined}
            onClick={canExpand ? () => toggle(entry.id) : undefined}
            data-testid="activity-row"
          >
            {canExpand ? (
              isSelected ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />
            ) : (
              <span className={styles.activitySpacer} />
            )}
            <Text size="small">{entry.label}</Text>
          </Stack>
        )
      },
    },
    {
      id: 'outcome',
      header: 'Outcome',
      field: 'success',
      sortBy: 'basic',
      renderCell: (entry) => (
        <Stack direction="horizontal" gap="condensed" align="center">
          {entry.success ? (
            <CheckCircleIcon size={16} fill="var(--fgColor-success)" />
          ) : (
            <XCircleIcon size={16} fill="var(--fgColor-danger)" />
          )}
          <Text size="small" className={styles.muted}>{entry.detail}</Text>
        </Stack>
      ),
    },
  ]

  return (
    <div className={styles.page}>
      <Heading as="h1">Activity</Heading>
      <Text as="p" className={styles.subtitle}>
        What ran, whether triggered headlessly (hotkey, schedule,
        clipboard/filesystem watch) or a direct Run click on Composition —
        a headless trigger fires with no other feedback, so this is the
        only place to see it happened at all. Session-only: this list
        isn&apos;t persisted across restarts.
      </Text>

      {activity.length > 0 && (
        <Stack direction="horizontal" gap="condensed" className={styles.filterRow}>
          <Select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as 'all' | ActivitySource)} aria-label="Filter by source">
            <Select.Option value="all">All sources</Select.Option>
            <Select.Option value="trigger">Trigger</Select.Option>
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
          <Text as="p">No activity yet — run a workflow, or wait for a trigger to fire, to see it appear here.</Text>
        </div>
      )}

      {activity.length > 0 && filtered.length === 0 && (
        <div className={styles.empty}>
          <Text as="p">No activity matches this filter.</Text>
        </div>
      )}

      {filtered.length > 0 && (
        <DataTable data={filtered} columns={columns} cellPadding="condensed" getRowId={(entry) => entry.id} />
      )}

      {selectedEntries.map((entry) => (
        <div key={entry.id} data-testid="activity-detail">
          <Stack direction="horizontal" justify="space-between" align="center">
            <Text size="small" weight="semibold">{entry.label} — {entry.time}</Text>
            <IconButton icon={XIcon} aria-label="Close" size="small" variant="invisible" onClick={() => toggle(entry.id)} />
          </Stack>
          <pre className={styles.result}>{entry.result}</pre>
        </div>
      ))}

      {filtersActive && filtered.length > 0 && (
        <Text as="p" size="small" className={styles.muted}>
          Showing {filtered.length} of {activity.length}.
        </Text>
      )}
    </div>
  )
}

export default ActivityView
