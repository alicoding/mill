import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Events } from '@wailsio/runtime'
import { Button, Stack, Text, TextInput } from '@primer/react'
import { DataTable, type Column, Blankslate } from '@primer/react/experimental'
import { StopIcon, HistoryIcon } from '@primer/octicons-react'
import { ResizableTableContainer, TruncatedCell } from '../shared/ResizableTable'
import { CopyDiagnosisButton } from '../shared/CopyDiagnosisButton'
import { ExecutionService } from '../shared/bindings'
import type { RunSummary } from '../shared/bindings'
import type { Workflow } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { useAppStore } from '../shared/store'
import { formatRunStartedAt, runStatusLabel } from '../shared/runTime'
import { StalenessBadge } from '../shared/StalenessBadge'
import { StatusStamp } from '../shared/StatusStamp'
import { ENQUEUED_STALE_THRESHOLD_MS, isStuckEnqueued } from '../shared/enqueuedStale'
import styles from '../shared/ListCard.module.css'
import monoStyles from '../shared/monoText.module.css'

// The source-first half of the reference analytics pattern
// (docs/SPEC.md §3.2, asked for directly: "select the input source
// then you see the list of activity for it ... columns ... search
// based on the attributes available for the input itself"): Activity's
// DURABLE run history (DBOS-backed, survives restarts). With a
// selected workflow, that workflow's own runs plus one column per
// attribute it declares; with workflow null, every workflow's recent
// runs (ExecutionService.ListRuns) with a workflow column instead --
// the surface where a failed run is always findable, however it was
// started.
export function ActivityRunsExplorer({ workflow }: { workflow: Workflow | null }) {
  const { t } = useTranslation('views')
  const requestOpenWorkflow = useAppStore((s) => s.requestOpenWorkflow)
  const setView = useAppStore((s) => s.setView)
  const workflows = useAppStore((s) => s.workflows)
  const [runs, setRuns] = useState<RunSummary[] | null>(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [cancellingID, setCancellingID] = useState('')

  // A null workflow is the cross-workflow mode: every recorded run,
  // durable across restarts -- the surface a failed canvas run lands
  // on even when no specific workflow is selected.
  const refresh = () => {
    const call = workflow ? ExecutionService.ListRunsForWorkflow(workflow.ID) : ExecutionService.ListRuns()
    call
      .then((list) => setRuns(list ?? []))
      .catch((err) => setError(String(err)))
  }

  useEffect(() => {
    setRuns(null)
    setError('')
    // The query belongs to the scope it was typed in -- carrying it
    // across a workflow switch silently empties the new table.
    setSearch('')
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflow?.ID])

  // goal 0017 P1-4: this explorer's durable run history used to update
  // only on mount/workflow-switch -- scoped to the selected workflow,
  // same as WorkflowRunsPanel.tsx's identical subscription.
  useEffect(() => {
    return Events.On('mill-data-changed', (evt) => {
      const entity = (evt.data as { entity?: string })?.entity
      if (entity === 'run') refresh()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflow?.ID])

  // Stuck-ENQUEUED runs get a Stop affordance right in this table
  // (docs/goals/0026 item 8) -- this view has no per-row detail/click-
  // through of its own (unlike WorkflowRunsPanel's own Stop, which
  // lives behind opening a run), so the age-emphasized status alone
  // would be "so what I can do and nothing I can do" without one.
  const cancelRun = (runID: string) => {
    setCancellingID(runID)
    setError('')
    ExecutionService.CancelRun(runID)
      .then(refresh)
      .catch((err) => setError(String(err)))
      .finally(() => setCancellingID(''))
  }

  const attrs = workflow?.Attributes ?? []
  const query = search.trim().toLowerCase()
  const filtered = (runs ?? []).filter((run) => {
    if (query === '') return true
    const values = Object.values(run.values ?? {}).map((v) => String(v ?? '').toLowerCase())
    return values.some((v) => v.includes(query))
      || (run.output ?? '').toLowerCase().includes(query)
      || (run.error ?? '').toLowerCase().includes(query)
  })

  const columns: Column<RunSummary & { id: string }>[] = [
    {
      id: 'started', header: t('activityRunsExplorer.columns.started'), width: 'auto',
      renderCell: (run) => <Text size="small" className={`${styles.muted} ${monoStyles.mono}`}>{formatRunStartedAt(run.startedAt as unknown as string)}</Text>,
    },
    // Cross-workflow mode names which workflow each run belongs to;
    // the label doubles as the jump into that workflow.
    ...(workflow ? [] : [{
      id: 'workflow', header: t('activityRunsExplorer.columns.workflow'), width: 'auto',
      renderCell: (run) => (
        <Button size="small" variant="invisible" data-testid="activity-run-workflow" onClick={() => requestOpenWorkflow(run.workflowID)}>
          {(workflows ?? []).find((w) => w.ID === run.workflowID)?.Label ?? run.workflowID}
        </Button>
      ),
    } satisfies Column<RunSummary & { id: string }>]),
    {
      id: 'kind', header: t('activityRunsExplorer.columns.kind'), width: 'auto',
      // Both neutral -- categorization (how the run started), not a
      // status verdict; see WorkflowRunsPanel.tsx's own KIND_VARIANT.
      renderCell: (run) => <StatusStamp variant="neutral">{run.kind}</StatusStamp>,
    },
    {
      id: 'version', header: t('activityRunsExplorer.columns.version'), width: 'auto',
      renderCell: (run) => (run.version > 0 ? `v${run.version}` : t('activityRunsExplorer.draft')),
    },
    {
      id: 'status', header: t('activityRunsExplorer.columns.status'), width: 'auto',
      renderCell: (run) => (
        <Stack direction="horizontal" gap="condensed" align="center">
          <StatusStamp variant={run.status === 'SUCCESS' ? 'success' : run.status === 'ERROR' ? 'danger' : 'caution'}>
            {runStatusLabel(run, t)}
          </StatusStamp>
          {/* Stuck-ENQUEUED presentation (docs/goals/0026 item 8) --
              same age-tier language as item 2's pending-approval
              treatment, at ENQUEUED's own 5-minute bar. */}
          {isStuckEnqueued(run) && (
            <StalenessBadge
              createdAt={run.startedAt}
              thresholdMs={ENQUEUED_STALE_THRESHOLD_MS}
              showExpiry={false}
              testId="activity-run-enqueued-stale"
            />
          )}
        </Stack>
      ),
    },
    {
      id: 'actions', header: '', width: 'auto',
      renderCell: (run) => isStuckEnqueued(run) ? (
        <Button
          size="small" variant="danger" leadingVisual={StopIcon}
          disabled={cancellingID === run.runID}
          data-testid="activity-run-cancel"
          onClick={() => cancelRun(run.runID)}
        >
          {t('activityRunsExplorer.stop')}
        </Button>
      ) : null,
    },
    // One column per declared attribute -- the workflow's own typed
    // input schema drives the table's shape, exactly the reference
    // pattern's point.
    ...attrs.map((a): Column<RunSummary & { id: string }> => ({
      id: `attr-${a.Key}`, header: a.Label || a.Key, width: 'auto',
      renderCell: (run) => <Text size="small">{run.values?.[a.Key] ?? ''}</Text>,
    })),
    {
      id: 'output', header: t('activityRunsExplorer.columns.output'), width: 'growCollapse', minWidth: '160px',
      // A failed run's most useful output is its error -- an ERROR row
      // must never render an empty cell. The cell itself still
      // truncates; the copy button's payload carries the FULL error.
      renderCell: (run) => (
        <Stack direction="horizontal" gap="condensed" align="center">
          <TruncatedCell text={run.error || (run.output ?? '')} />
          {run.error && (
            <CopyDiagnosisButton
              error={run.error}
              context={{ Workflow: run.workflowLabel, 'Run ID': run.runID, Started: run.startedAt }}
              testId="activity-run-copy-diagnosis"
            />
          )}
        </Stack>
      ),
    },
  ]

  return (
    <Stack direction="vertical" gap="normal" data-testid="activity-runs-explorer">
      <TextInput
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={attrs.length > 0
          ? t('activityRunsExplorer.searchByAttrsOrOutput', { attrs: attrs.map((a) => a.Label || a.Key).join(', ') })
          : t('activityRunsExplorer.searchByOutput')}
        aria-label={t('activityRunsExplorer.searchAriaLabel')}
        data-testid="runs-explorer-search"
      />
      {error && <Text as="p" size="small" className={styles.error}>{error}</Text>}
      {runs === null && !error && <Text as="p" className={styles.muted}>{t('activityRunsExplorer.loading')}</Text>}
      {/* Design-wave-1 fix #7: the "no runs yet" case (as opposed to
          "no runs match this search", still plain text -- a search
          miss isn't the same invitation-to-act moment) now matches
          WorkflowRunsPanel's own Blankslate treatment, the same
          icon+one-line-invitation pattern Review's empty state uses. */}
      {runs !== null && filtered.length === 0 && (
        runs.length === 0 ? (
          <Blankslate data-testid="activity-runs-explorer-empty">
            <Blankslate.Visual>
              <HistoryIcon size={32} />
            </Blankslate.Visual>
            <Blankslate.Heading>{t('activityRunsExplorer.noRecordedRuns')}</Blankslate.Heading>
            <Blankslate.Description>
              {workflow ? t('activityRunsExplorer.noRecordedRunsDescription') : t('activityRunsExplorer.noRecordedRunsAllDescription')}
            </Blankslate.Description>
            <Blankslate.PrimaryAction onClick={() => workflow ? requestOpenWorkflow(workflow.ID) : setView({ kind: 'composition' })}>
              {workflow ? t('activityRunsExplorer.openWorkflow') : t('emptyStateActions.runAWorkflow')}
            </Blankslate.PrimaryAction>
          </Blankslate>
        ) : (
          <Text as="p" className={styles.muted}>{t('activityRunsExplorer.noRunsMatchSearch')}</Text>
        )
      )}
      {filtered.length > 0 && (
        <ResizableTableContainer storageKey={workflow ? 'mill-cols-activity-runs' : 'mill-cols-activity-runs-all'}>
          <DataTable
            aria-label={workflow ? t('activityRunsExplorer.runsAriaLabel', { label: workflow.Label }) : t('activityRunsExplorer.allRunsAriaLabel')}
            data={filtered.map((r) => ({ ...r, id: r.runID }))}
            columns={columns}
          />
        </ResizableTableContainer>
      )}
    </Stack>
  )
}
