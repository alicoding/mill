import { useEffect, useState } from 'react'
import { Button, IconButton, Label, type LabelProps, Select, Stack, Text } from '@primer/react'
import { DataTable, type Column } from '@primer/react/experimental'
import { CheckCircleIcon, XCircleIcon, ClockIcon, XIcon, ShieldIcon, ShieldXIcon } from '@primer/octicons-react'
import * as ExecutionService from '../../bindings/github.com/alicoding/mill/executionservice'
import { RunKind, type RunDetail, type RunStep, type RunSummary } from '../../bindings/github.com/alicoding/mill/models'
import styles from '../shared/ListCard.module.css'
import PageContainer from '../shared/PageContainer'

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
  'awaiting-approval': <ShieldIcon size={16} fill="var(--fgColor-attention)" />,
  denied: <ShieldXIcon size={16} fill="var(--fgColor-danger)" />,
}

interface WorkflowRunsPanelProps {
  workflowId: string
}

// One workflow's own durable-run history + per-step detail + redrive --
// the successor to the old standalone Runs page (docs/SPEC.md §7's
// Update). Real precedent checked before this shape was picked (n8n,
// Retool, Airflow all scope this to the individual workflow's own page,
// a tab/panel next to its editor, never a global page reached via a
// workflow picker) -- "you always run where you see your work," not a
// separate destination to go find it. No Run button here: Canvas's own
// toolbar is still the one Run entrypoint (docs/adr/0008's single
// execution path), this tab is purely for reviewing what already ran.
// Activity (views/ActivityView.tsx) stays the lightweight, cross-
// workflow, session-only "did anything run at all" feed -- unrelated
// and unchanged by this.
function WorkflowRunsPanel({ workflowId }: WorkflowRunsPanelProps) {
  const [runs, setRuns] = useState<RunSummary[] | null>(null)
  const [selectedRunID, setSelectedRunID] = useState<string | null>(null)
  const [detail, setDetail] = useState<RunDetail | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [kindFilter, setKindFilter] = useState<'all' | RunKind>('all')

  const refreshRuns = () => {
    ExecutionService.ListRunsForWorkflow(workflowId)
      .then((result) => setRuns(result ?? []))
      .catch((err) => setError(String(err)))
  }

  useEffect(() => {
    refreshRuns()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowId])

  useEffect(() => {
    if (!selectedRunID) {
      setDetail(null)
      return
    }
    ExecutionService.GetRun(selectedRunID)
      .then(setDetail)
      .catch((err) => setError(String(err)))
  }, [selectedRunID])

  // While the open run is still in flight (running, or parked awaiting
  // approval), poll it -- a parked run's resume/deny happens
  // asynchronously after ResolveApproval, and "nothing hidden" means
  // the panel shows the transition without a manual refresh
  // (docs/adr/0022's Update).
  useEffect(() => {
    if (!selectedRunID || !detail) return
    const inFlight = detail.status === 'PENDING' || detail.status === 'RUNNING' || detail.status === 'ENQUEUED'
    if (!inFlight) return
    const timer = setInterval(() => {
      ExecutionService.GetRun(selectedRunID).then(setDetail).catch(() => {})
      refreshRuns()
    }, 1000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRunID, detail?.status])

  const resolveApproval = (nodeID: string, approve: boolean) => {
    if (!selectedRunID) return
    setBusy(true)
    setError('')
    ExecutionService.ResolveApproval(selectedRunID, nodeID, approve, {})
      .then(() => setBusy(false))
      .catch((err) => { setError(String(err)); setBusy(false) })
    // The in-flight poll below picks up the resumed/failed state.
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
  // UniqueRow constraint) -- RunSummary's own identity field is runID.
  type RunRow = RunSummary & { id: string }
  const rows: RunRow[] = (runs ?? [])
    .filter((run) => kindFilter === 'all' || run.kind === kindFilter)
    .map((run) => ({ ...run, id: run.runID }))

  const columns: Column<RunRow>[] = [
    {
      id: 'status',
      header: 'Status',
      field: 'status',
      sortBy: 'alphanumeric',
      renderCell: (run) => run.pending ? (
        <Label variant="attention" size="small" data-testid="run-awaiting-approval">awaiting approval</Label>
      ) : (
        <Label variant={STATUS_VARIANT[run.status] ?? 'secondary'} size="small">{run.status}</Label>
      ),
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
    <PageContainer data-testid="workflow-runs-panel">
      <Stack direction="horizontal" gap="condensed" align="center" className={styles.filterRow}>
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
          <Text as="p">No runs yet — run this workflow from its Canvas tab.</Text>
        </div>
      )}

      {runs !== null && runs.length > 0 && (
        <DataTable data={rows} columns={columns} cellPadding="condensed" getRowId={(run) => run.id} />
      )}

      {detail && (
        <div className={styles.card} data-testid="run-detail" style={{ marginTop: 'var(--base-size-16)' }}>
          <Stack direction="horizontal" justify="space-between" align="center">
            <Text weight="semibold">
              <Label variant={STATUS_VARIANT[detail.status] ?? 'secondary'} size="small">{detail.status}</Label>
            </Text>
            <IconButton icon={XIcon} aria-label="Close" size="small" variant="invisible" onClick={() => setSelectedRunID(null)} />
          </Stack>
          {detail.error && <Text as="p" className={styles.error}>{detail.error}</Text>}

          {detail.pending && (
            <div className={styles.card} data-testid="approval-banner" style={{ marginTop: 'var(--base-size-12)' }}>
              <Stack direction="vertical" gap="condensed">
                <Stack direction="horizontal" gap="condensed" align="center">
                  <ShieldIcon size={16} fill="var(--fgColor-attention)" />
                  <Text weight="semibold">Awaiting your approval</Text>
                </Stack>
                <Text size="small">
                  The step <Text weight="semibold">{detail.pending.nodeTypeLabel || detail.pending.nodeTypeID}</Text>{' '}
                  wants to run{detail.pending.ruleLabel ? ` (rule: ${detail.pending.ruleLabel})` : ' (external steps ask by default)'}.
                </Text>
                {detail.pending.payload && (
                  <pre className={styles.result}>{detail.pending.payload}</pre>
                )}
                <Stack direction="horizontal" gap="condensed">
                  <Button size="small" variant="primary" disabled={busy} data-testid="approve-step"
                    onClick={() => resolveApproval(detail.pending!.nodeID, true)}>
                    Approve and run
                  </Button>
                  <Button size="small" variant="danger" disabled={busy} data-testid="deny-step"
                    onClick={() => resolveApproval(detail.pending!.nodeID, false)}>
                    Deny
                  </Button>
                </Stack>
              </Stack>
            </div>
          )}

          <Stack direction="vertical" gap="condensed" style={{ marginTop: 'var(--base-size-12)' }}>
            {(detail.steps ?? []).map((step) => (
              <Stack key={step.nodeID} direction="horizontal" justify="space-between" align="start" gap="condensed">
                <Stack direction="horizontal" gap="condensed" align="start">
                  <span className={styles.icon}>{STEP_ICON[step.status]}</span>
                  <div>
                    <Text size="small" weight="semibold">{step.nodeTypeLabel || step.nodeTypeID}</Text>
                    {step.guardrailEffect && (
                      <Text as="p" size="small" className={styles.muted} data-testid="step-guardrail">
                        Guardrail: {step.guardrailEffect}{step.guardrailRule ? ` (rule: ${step.guardrailRule})` : ''}
                      </Text>
                    )}
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
    </PageContainer>
  )
}

export default WorkflowRunsPanel
