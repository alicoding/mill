import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Heading, IconButton, Label, type LabelProps, Select, Stack, Text, TextInput } from '@primer/react'
import { DataTable, type Column } from '@primer/react/experimental'
import { ChevronDownIcon, ChevronRightIcon, CheckCircleIcon, WorkflowIcon, XCircleIcon, XIcon } from '@primer/octicons-react'
import { useAppStore, type ActivityEntry, type ActivitySource } from '../shared/store'
import { WorkflowHoverPreview } from '../composition/WorkflowHoverPreview'
import { ActivityRunsExplorer } from './ActivityRunsExplorer'
import styles from '../shared/ListCard.module.css'
import PageContainer from '../shared/PageContainer'

function sourceLabelFor(t: (key: string) => string): Record<ActivitySource, string> {
  return {
    trigger: t('activityView.sourceLabel.trigger'),
    composition: t('activityView.sourceLabel.composition'),
    'mcp-write': t('activityView.sourceLabel.mcp-write'),
  }
}

const SOURCE_VARIANT: Record<ActivitySource, LabelProps['variant']> = {
  trigger: 'severe',
  composition: 'success',
  'mcp-write': 'attention',
}

type OutcomeFilter = 'all' | 'success' | 'failed'

// docs/SPEC.md §3.7's Update -- same localStorage/cosmetic tier as
// App.tsx's sidebarOpen (a filter selection is a UI preference, not
// domain data; Mill's real settings store is reserved for the latter).
const SOURCE_FILTER_STORAGE_KEY = 'mill-activity-source-filter'
const OUTCOME_FILTER_STORAGE_KEY = 'mill-activity-outcome-filter'

// A dedicated, always-visible page: a headless trigger (hotkey, schedule,
// clipboard-watch, filesystem-watch -- docs/SPEC.md §3.4) fires with no
// other UI surface, so this is the only way to see whether anything
// fired at all — nested inside another page, it was indistinguishable
// from "the feed doesn't work" when nothing had fired yet. Subscribed
// once at App.tsx (not here) so it keeps collecting even while this tab
// isn't the active view. Not trigger-only: every run pushes here
// regardless of how it was triggered (a headless fire, or a direct Run
// click on a workflow) — one shared feed for "did anything run," not
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
  const { t } = useTranslation('views')
  const SOURCE_LABEL = sourceLabelFor(t)
  const activity = useAppStore((s) => s.activity)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [sourceFilter, setSourceFilter] = useState<'all' | ActivitySource>(
    () => (localStorage.getItem(SOURCE_FILTER_STORAGE_KEY) as 'all' | ActivitySource | null) ?? 'all',
  )
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>(
    () => (localStorage.getItem(OUTCOME_FILTER_STORAGE_KEY) as OutcomeFilter | null) ?? 'all',
  )
  useEffect(() => {
    localStorage.setItem(SOURCE_FILTER_STORAGE_KEY, sourceFilter)
  }, [sourceFilter])
  useEffect(() => {
    localStorage.setItem(OUTCOME_FILTER_STORAGE_KEY, outcomeFilter)
  }, [outcomeFilter])
  // Free-text search over what ran and what it produced -- the first
  // slice of the reference analytics pattern (docs/SPEC.md §3.2's
  // AI-Analytics surface: filterable events, searchable by the run's
  // own data), deliberately session-local like the list itself.
  const [search, setSearch] = useState('')
  // Source-first selection (the fuller reference pattern, asked for
  // directly): picking a specific workflow swaps the session feed for
  // that workflow's durable run history with attribute-driven columns
  // (ActivityRunsExplorer). 'all' keeps the live cross-workflow feed.
  const workflows = useAppStore((s) => s.workflows)
  const [sourceWorkflow, setSourceWorkflow] = useState('all')
  const selectedWorkflow = sourceWorkflow === 'all' ? null : (workflows ?? []).find((w) => w.ID === sourceWorkflow) ?? null

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const query = search.trim().toLowerCase()
  const filtered = activity.filter((entry) => {
    if (sourceFilter !== 'all' && entry.source !== sourceFilter) return false
    if (outcomeFilter === 'success' && !entry.success) return false
    if (outcomeFilter === 'failed' && entry.success) return false
    if (query !== '' && !entry.label.toLowerCase().includes(query) && !entry.result.toLowerCase().includes(query)) return false
    return true
  })
  const filtersActive = sourceFilter !== 'all' || outcomeFilter !== 'all' || query !== ''
  const selectedEntries = filtered.filter((entry) => selectedIds.has(entry.id) && entry.result !== '')

  const columns: Column<ActivityEntry>[] = [
    {
      id: 'time',
      header: t('activityView.columns.time'),
      field: 'timestamp',
      sortBy: 'basic',
      width: '120px',
      renderCell: (entry) => <Text size="small" className={styles.muted}>{entry.time}</Text>,
    },
    {
      id: 'source',
      header: t('activityView.columns.source'),
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
      header: t('activityView.columns.action'),
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
            {/* A separate peek icon, not the label itself, anchors the
                hover-preview (docs/SPEC.md §3.8's n8n/[decisioning-vendor] pattern)
                -- the label keeps its existing expand-the-result click
                untouched (a first cut wrapped the label and silently
                broke that click; caught by the existing activity e2e). */}
            {entry.workflowID && (
              <span onClick={(e) => e.stopPropagation()}>
                <WorkflowHoverPreview workflowId={entry.workflowID}>
                  <WorkflowIcon size={12} aria-label={t('activityView.previewAriaLabel', { label: entry.label })} />
                </WorkflowHoverPreview>
              </span>
            )}
          </Stack>
        )
      },
    },
    {
      id: 'outcome',
      header: t('activityView.columns.outcome'),
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
    <PageContainer>
      <Heading as="h1">{t('activityView.heading')}</Heading>
      <Text as="p" className={styles.subtitle}>
        {t('activityView.subtitle')}
      </Text>

      <Stack direction="horizontal" gap="condensed" className={styles.filterRow}>
        <Select value={sourceWorkflow} onChange={(e) => setSourceWorkflow(e.target.value)} aria-label={t('activityView.inputSourceAriaLabel')} data-testid="activity-source-workflow">
          <Select.Option value="all">{t('activityView.allWorkflowsLiveFeed')}</Select.Option>
          {(workflows ?? []).map((w) => (
            <Select.Option key={w.ID} value={w.ID}>{w.Label}</Select.Option>
          ))}
        </Select>
      </Stack>

      {selectedWorkflow && <ActivityRunsExplorer workflow={selectedWorkflow} />}

      {!selectedWorkflow && activity.length > 0 && (
        <Stack direction="horizontal" gap="condensed" className={styles.filterRow}>
          <Select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as 'all' | ActivitySource)} aria-label={t('activityView.filterBySourceAriaLabel')}>
            <Select.Option value="all">{t('activityView.allSources')}</Select.Option>
            <Select.Option value="trigger">{t('activityView.sourceLabel.trigger')}</Select.Option>
            <Select.Option value="composition">{t('activityView.sourceLabel.composition')}</Select.Option>
            <Select.Option value="mcp-write">{t('activityView.sourceLabel.mcp-write')}</Select.Option>
          </Select>
          <Select value={outcomeFilter} onChange={(e) => setOutcomeFilter(e.target.value as OutcomeFilter)} aria-label={t('activityView.filterByOutcomeAriaLabel')}>
            <Select.Option value="all">{t('activityView.allOutcomes')}</Select.Option>
            <Select.Option value="success">{t('activityView.success')}</Select.Option>
            <Select.Option value="failed">{t('activityView.failed')}</Select.Option>
          </Select>
          <TextInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('activityView.searchPlaceholder')}
            aria-label={t('activityView.searchAriaLabel')}
            data-testid="activity-search"
          />
        </Stack>
      )}

      {!selectedWorkflow && activity.length === 0 && (
        <div className={styles.empty}>
          <Text as="p">{t('activityView.noActivityYet')}</Text>
        </div>
      )}

      {!selectedWorkflow && activity.length > 0 && filtered.length === 0 && (
        <div className={styles.empty}>
          <Text as="p">{t('activityView.noActivityMatchesFilter')}</Text>
        </div>
      )}

      {!selectedWorkflow && filtered.length > 0 && (
        <DataTable data={filtered} columns={columns} cellPadding="condensed" getRowId={(entry) => entry.id} />
      )}

      {!selectedWorkflow && selectedEntries.map((entry) => (
        <div key={entry.id} data-testid="activity-detail">
          <Stack direction="horizontal" justify="space-between" align="center">
            <Text size="small" weight="semibold">{entry.label} — {entry.time}</Text>
            <IconButton icon={XIcon} aria-label={t('activityView.closeAriaLabel')} size="small" variant="invisible" onClick={() => toggle(entry.id)} />
          </Stack>
          <pre className={styles.result}>{entry.result}</pre>
        </div>
      ))}

      {filtersActive && filtered.length > 0 && (
        <Text as="p" size="small" className={styles.muted}>
          {t('activityView.showingCount', { shown: filtered.length, total: activity.length })}
        </Text>
      )}
    </PageContainer>
  )
}

export default ActivityView
