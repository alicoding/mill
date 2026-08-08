import { useEffect, useState } from 'react'
import { Button, Heading, IconButton, Label, type LabelProps, Select, Stack, Text } from '@primer/react'
import { DataTable, type Column } from '@primer/react/experimental'
import { CheckCircleIcon, XCircleIcon, ClockIcon, SyncIcon, XIcon } from '@primer/octicons-react'
import * as ExecutionService from '../../bindings/github.com/alicoding/mill/executionservice'
import { RunKind, type RunDetail, type RunStep, type RunSummary } from '../../bindings/github.com/alicoding/mill/models'
import { useAppStore } from '../shared/store'
import styles from '../shared/ListCard.module.css'

const STATUS_VARIANT: Record<string, LabelProps['variant']> = {
  SUCCESS: 'success',
  ERROR: 'danger',
  PENDING: 'attention',
  ENQUEUED: 'attention',
  CANCELLED: 'secondary',
  MAX_RECOVERY_ATTEMPTS_EXCEEDED: 'danger',
}

const KIND_LABEL: Record<RunKind, string> = {
  [RunKind.$zero]: 'test', // pre-docs/adr/0008 runs recorded before Kind existed default to "test" server-side (executionservice.go)
  [RunKind.RunKindTest]: 'test',
  [RunKind.RunKindTriggered]: 'triggered',
}

const KIND_VARIANT: Record<RunKind, LabelProps['variant']> = {
  [RunKind.$zero]: 'secondary',
  [RunKind.RunKindTest]: 'secondary',
  [RunKind.RunKindTriggered]: 'severe',
}

const STEP_ICON: Record<RunStep['status'], React.ReactNode> = {
  succeeded: <CheckCircleIcon size={16} fill="var(--fgColor-success)" />,
  failed: <XCircleIcon size={16} fill="var(--fgColor-danger)" />,
  pending: <ClockIcon size={16} fill="var(--fgColor-muted)" />,
}

// The durable-execution counterpart to ActivityView (docs/adr/0004):
// every run through ExecutionService.RunWorkflow is checkpointed
// step-by-step and stays inspectable/redrivable here after the fact,
// unlike Activity's plain in-memory, session-only feed. Deliberately a
// separate page, not a merge into Activity -- Activity already covers
// "did anything run" for every source including headless triggers,
// while this is specifically the DBOS-backed execution-visibility +
// fix-forward surface named in docs/SPEC.md §3.2's Oscilar/n8n research
// (per-run step breakdown, redrive a failed step instead of restarting).
function RunsView() {
  const workflows = useAppStore((s) => s.workflows)
  const [runs, setRuns] = useState<RunSummary[] | null>(null)
  const [selectedRunID, setSelectedRunID] = useState<string | null>(null)
  const [detail, setDetail] = useState<RunDetail | null>(null)
  const [runningWorkflowID, setRunningWorkflowID] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [kindFilter, setKindFilter] = useState<'all' | RunKind>('all')

  const refreshRuns = () => {
    ExecutionService.ListRuns()
      .then((result) => setRuns(result ?? []))
      .catch((err) => setError(String(err)))
  }

  useEffect(() => {
    refreshRuns()
  }, [])

  useEffect(() => {
    if (!selectedRunID) {
      setDetail(null)
      return
    }
    ExecutionService.GetRun(selectedRunID)
      .then(setDetail)
      .catch((err) => setError(String(err)))
  }, [selectedRunID])

  // docs/adr/0008: this is one of two UI entrypoints into the same
  // single execution path (Composition's canvas Run button is the
  // other) -- both tag RunKindTest, since both are manual/UI-driven,
  // not a real external event. There's no separate "durable" run mode
  // anymore; every run through ExecutionService.RunWorkflow is durable.
  const runWorkflow = () => {
    if (!runningWorkflowID) return
    setBusy(true)
    setError('')
    ExecutionService.RunWorkflow(runningWorkflowID, RunKind.RunKindTest, null)
      .then((summary) => {
        refreshRuns()
        setSelectedRunID(summary.runID)
      })
      .catch((err) => setError(String(err)))
      .finally(() => setBusy(false))
  }

  const redrive = (fromNodeID: string) => {
    if (!selectedRunID) return
    setBusy(true)
    setError('')
    ExecutionService.RedriveRun(selectedRunID, fromNodeID)
      .then((summary) => {
        refreshRuns()
        setSelectedRunID(summary.runID)
      })
      .catch((err) => setError(String(err)))
      .finally(() => setBusy(false))
  }

  // DataTable's generic requires a literal `id` field (Primer's own
  // UniqueRow constraint, confirmed via the compiler, not assumed) --
  // RunSummary's own identity field is runID, so rows are a thin,
  // locally-derived view rather than renaming the Go-side field just to
  // satisfy this one component.
  type RunRow = RunSummary & { id: string }
  const rows: RunRow[] = (runs ?? [])
    .filter((run) => kindFilter === 'all' || run.kind === kindFilter)
    .map((run) => ({ ...run, id: run.runID }))

  const columns: Column<RunRow>[] = [
    {
      id: 'workflow',
      header: 'Workflow',
      field: 'workflowLabel',
      sortBy: 'alphanumeric',
      renderCell: (run) => <Text size="small">{run.workflowLabel}</Text>,
    },
    {
      id: 'status',
      header: 'Status',
      field: 'status',
      sortBy: 'alphanumeric',
      renderCell: (run) => <Label variant={STATUS_VARIANT[run.status] ?? 'secondary'} size="small">{run.status}</Label>,
    },
    {
      id: 'kind',
      header: 'Kind',
      field: 'kind',
      sortBy: 'alphanumeric',
      renderCell: (run) => <Label variant={KIND_VARIANT[run.kind]} size="small">{KIND_LABEL[run.kind]}</Label>,
    },
    {
      id: 'started',
      header: 'Started',
      field: 'startedAt',
      sortBy: 'datetime',
      renderCell: (run) => <Text size="small" className={styles.muted}>{new Date(run.startedAt).toLocaleString()}</Text>,
    },
    {
      id: 'action',
      header: '',
      width: '96px',
      renderCell: (run) => (
        <Button size="small" onClick={() => setSelectedRunID(run.runID)}>View</Button>
      ),
    },
  ]

  return (
    <div className={styles.page}>
      <Heading as="h1">Runs</Heading>
      <Text as="p" className={styles.subtitle}>
        Every run — from here, Composition's canvas, or a headless
        trigger — is checkpointed step by step (docs/adr/0004,
        docs/adr/0008) so a result survives the process that reported it
        dying, and a failed run can be redriven from its failing step
        instead of restarted from scratch. Distinct from Activity: this
        persists across restarts (Activity is session-only).
      </Text>

      <Stack direction="horizontal" gap="condensed" align="center" className={styles.filterRow}>
        <Select
          value={runningWorkflowID}
          onChange={(e) => setRunningWorkflowID(e.target.value)}
          aria-label="Choose a workflow to run"
        >
          <Select.Option value="">Choose a workflow…</Select.Option>
          {(workflows ?? []).map((wf) => (
            <Select.Option key={wf.ID} value={wf.ID}>{wf.Label}</Select.Option>
          ))}
        </Select>
        <Button
          variant="primary"
          leadingVisual={SyncIcon}
          disabled={!runningWorkflowID || busy}
          onClick={runWorkflow}
        >
          Run
        </Button>
        <Select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as 'all' | RunKind)} aria-label="Filter by kind">
          <Select.Option value="all">All kinds</Select.Option>
          <Select.Option value={RunKind.RunKindTest}>Test</Select.Option>
          <Select.Option value={RunKind.RunKindTriggered}>Triggered</Select.Option>
        </Select>
      </Stack>

      {error && <Text as="p" className={styles.error}>{error}</Text>}

      {runs === null && (
        <div className={styles.empty}><Text as="p">Loading…</Text></div>
      )}

      {runs !== null && runs.length === 0 && (
        <div className={styles.empty}>
          <Text as="p">No runs yet — pick a workflow above and click &quot;Run&quot;.</Text>
        </div>
      )}

      {runs !== null && runs.length > 0 && (
        <DataTable data={rows} columns={columns} cellPadding="condensed" getRowId={(run) => run.id} />
      )}

      {detail && (
        <div className={styles.card} data-testid="run-detail" style={{ marginTop: 'var(--base-size-16)' }}>
          <Stack direction="horizontal" justify="space-between" align="center">
            <Text weight="semibold">
              {detail.workflowLabel} — <Label variant={STATUS_VARIANT[detail.status] ?? 'secondary'} size="small">{detail.status}</Label>
            </Text>
            <IconButton icon={XIcon} aria-label="Close" size="small" variant="invisible" onClick={() => setSelectedRunID(null)} />
          </Stack>
          {detail.error && <Text as="p" className={styles.error}>{detail.error}</Text>}

          <Stack direction="vertical" gap="condensed" style={{ marginTop: 'var(--base-size-12)' }}>
            {(detail.steps ?? []).map((step) => (
              <Stack key={step.nodeID} direction="horizontal" justify="space-between" align="start" gap="condensed">
                <Stack direction="horizontal" gap="condensed" align="start">
                  <span className={styles.icon}>{STEP_ICON[step.status]}</span>
                  <div>
                    <Text size="small" weight="semibold">{step.nodeTypeLabel || step.nodeTypeID}</Text>
                    {step.output && <pre className={styles.result}>{step.output}</pre>}
                    {step.error && <Text as="p" size="small" className={styles.error}>{step.error}</Text>}
                  </div>
                </Stack>
                {step.status === 'failed' && (
                  <Button size="small" disabled={busy} onClick={() => redrive(step.nodeID)}>
                    Redrive from here
                  </Button>
                )}
              </Stack>
            ))}
          </Stack>
        </div>
      )}
    </div>
  )
}

export default RunsView
