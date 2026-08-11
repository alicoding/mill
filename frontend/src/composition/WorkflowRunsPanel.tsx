import { useEffect, useRef, useState } from 'react'
import { Button, IconButton, Label, type LabelProps, Select, Stack, Text } from '@primer/react'
import { DataTable, type Column } from '@primer/react/experimental'
import { BugIcon, CheckCircleIcon, XCircleIcon, ClockIcon, XIcon, ShieldIcon, ShieldXIcon, StopIcon } from '@primer/octicons-react'
import { ExecutionService } from '../shared/bindings'
import { RunKind, type RunDetail, type RunSummary } from '../shared/bindings'
import type { AttributeDef } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { ApprovalValuesForm, attrsForPending } from '../shared/ApprovalValuesForm'
import { formatRunStartedAt } from '../shared/runTime'
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

const STEP_ICON: Record<string, React.ReactNode> = {
  succeeded: <CheckCircleIcon size={16} fill="var(--fgColor-success)" />,
  failed: <XCircleIcon size={16} fill="var(--fgColor-danger)" />,
  pending: <ClockIcon size={16} fill="var(--fgColor-muted)" />,
  'awaiting-approval': <ShieldIcon size={16} fill="var(--fgColor-attention)" />,
  denied: <ShieldXIcon size={16} fill="var(--fgColor-danger)" />,
  // docs/adr/0026: a cancelled code-execution step is recorded
  // distinctly from an ordinary failure ("cancelled != failed").
  cancelled: <StopIcon size={16} fill="var(--fgColor-muted)" />,
}

interface WorkflowRunsPanelProps {
  workflowId: string
  // The owning workflow's declared Attributes -- what a parked run's
  // edit-and-resume form (docs/adr/0031 item 4) offers to override,
  // same source the canvas's own TestRunDialog reads.
  attrs: AttributeDef[]
  // Preselect this run's detail on mount/change -- the Review page's row
  // drill-down (docs/goals/0002-review-queue-maturation.md item 5).
  // Applied once per value via the effect below; onInitialRunConsumed
  // clears the store's pendingRunFocus so it isn't reapplied on a later
  // unrelated tab switch.
  initialRunId?: string
  onInitialRunConsumed?: () => void
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
function WorkflowRunsPanel({ workflowId, attrs, initialRunId, onInitialRunConsumed }: WorkflowRunsPanelProps) {
  const [runs, setRuns] = useState<RunSummary[] | null>(null)
  const [selectedRunID, setSelectedRunID] = useState<string | null>(null)
  // Scrolls the detail card into view when a row is picked -- the card
  // renders below the table, and with enough runs it can sit fully
  // off-screen, which compounded the "clicking View did nothing"
  // report the selected-state fix (the action column) addresses.
  const detailRef = useRef<HTMLDivElement | null>(null)
  const [detail, setDetail] = useState<RunDetail | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [kindFilter, setKindFilter] = useState<'all' | RunKind>('all')
  // Edit-and-resume input (docs/adr/0031 item 4) -- keyed by run ID like
  // ReviewView's own `inputs` state, so switching between parked runs
  // doesn't bleed one's typed values into another's.
  const [resumeValues, setResumeValues] = useState<Record<string, Record<string, string>>>({})

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
    if (!initialRunId) return
    setSelectedRunID(initialRunId)
    onInitialRunConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRunId])

  useEffect(() => {
    if (!selectedRunID) return
    // After the detail fetch lands and the card mounts/re-renders.
    const t = setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 150)
    return () => clearTimeout(t)
  }, [selectedRunID])

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

  // continueRun only matters for a stepped run's park (docs/adr/0031
  // §5) -- Step passes false (keeps step mode on), Continue/Resume
  // passes true. values is the edit-and-resume typed input (item 4),
  // discarded on a deny/stop.
  const resolveApproval = (nodeID: string, approve: boolean, continueRun = false) => {
    if (!selectedRunID) return
    setBusy(true)
    setError('')
    ExecutionService.ResolveApproval(selectedRunID, nodeID, approve, approve ? (resumeValues[selectedRunID] ?? {}) : {}, continueRun)
      .then(() => setBusy(false))
      .catch((err) => { setError(String(err)); setBusy(false) })
    // The in-flight poll below picks up the resumed/failed state.
  }

  // Stops an in-flight run (docs/adr/0026): kills any real running
  // process (procexec's group SIGTERM-then-SIGKILL) AND marks the
  // DBOS workflow CANCELLED -- one RPC, both effects. The in-flight
  // poll above picks up the resumed/terminal state, same as
  // resolveApproval.
  const cancelRun = () => {
    if (!selectedRunID) return
    setBusy(true)
    setError('')
    ExecutionService.CancelRun(selectedRunID)
      .then(() => setBusy(false))
      .catch((err) => { setError(String(err)); setBusy(false) })
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
      // The data-run-id/data-selected span is the row's identity anchor
      // for BOTH halves of whole-row clicking (owner's model: "always
      // able to click the row to view, without a separate button"):
      // the container's delegated onClick climbs from the clicked cell
      // to the row and reads this span's id (survives DataTable
      // sorting, unlike index math), and the CSS row highlight targets
      // tr:has([data-selected='true']) (ListCard.module.css).
      renderCell: (run) => (
        <span data-run-id={run.runID} data-selected={selectedRunID === run.runID}>
          {run.pending ? (
            <Label variant="attention" size="small" data-testid="run-awaiting-approval">awaiting approval</Label>
          ) : (
            <Label variant={STATUS_VARIANT[run.status] ?? 'secondary'} size="small">{run.status}</Label>
          )}
        </span>
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
      renderCell: (run) => <Text size="small" className={styles.muted}>{formatRunStartedAt(run.startedAt)}</Text>,
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
        // Whole-row click opens the run (owner's model — no separate
        // View button; matches Review's rows, the inventory rows, and
        // the reference platform's name-as-link pattern). Primer's
        // DataTable has no native onRowClick (checked its .d.ts), so
        // this is a delegated handler: climb from the clicked cell to
        // its row, read the identity anchor the status cell renders.
        <div
          className={styles.clickableRunsTable}
          data-testid="runs-table"
          onClick={(e) => {
            const row = (e.target as HTMLElement).closest('tr')
            const anchor = row?.querySelector('[data-run-id]')
            const id = anchor?.getAttribute('data-run-id')
            if (id) setSelectedRunID(id)
          }}
        >
          <DataTable data={rows} columns={columns} cellPadding="condensed" getRowId={(run) => run.id} />
        </div>
      )}

      {detail && (
        <div ref={detailRef} className={styles.card} data-testid="run-detail" style={{ marginTop: 'var(--base-size-16)' }}>
          <Stack direction="horizontal" justify="space-between" align="center">
            <Stack direction="horizontal" gap="condensed" align="center">
              <Label variant={STATUS_VARIANT[detail.status] ?? 'secondary'} size="small">{detail.status}</Label>
              {/* The run's own identity, so two identical-outcome runs
                  are still tellable apart in the detail header -- the
                  other half of the selected-row fix above. */}
              <Text size="small" weight="semibold" data-testid="run-detail-identity">
                Run · {formatRunStartedAt(detail.startedAt)}
              </Text>
            </Stack>
            <Stack direction="horizontal" gap="condensed" align="center">
              {(detail.status === 'PENDING' || detail.status === 'RUNNING' || detail.status === 'ENQUEUED') && (
                <Button
                  size="small" variant="danger" leadingVisual={StopIcon} disabled={busy}
                  data-testid="cancel-run" onClick={cancelRun}
                >
                  Stop
                </Button>
              )}
              <IconButton icon={XIcon} aria-label="Close" size="small" variant="invisible" onClick={() => setSelectedRunID(null)} />
            </Stack>
          </Stack>
          {detail.error && <Text as="p" className={styles.error}>{detail.error}</Text>}

          {detail.pending && (() => {
            // A breakpoint or step-mode park is a DEBUG park
            // (docs/adr/0031) -- distinct icon/wording/controls, never
            // the same as a policy ask ("recognition, not
            // confirmation"). A stepped run additionally offers Step
            // (advance one node, keep stepping) beside Continue/Resume.
            const pending = detail.pending
            const isDebug = pending.source === 'debug'
            const isStepped = pending.stepped
            return (
              <div className={styles.card} data-testid="approval-banner" style={{ marginTop: 'var(--base-size-12)' }}>
                <Stack direction="vertical" gap="condensed">
                  <Stack direction="horizontal" gap="condensed" align="center">
                    {isDebug ? <BugIcon size={16} fill="var(--fgColor-done)" /> : <ShieldIcon size={16} fill="var(--fgColor-attention)" />}
                    <Text weight="semibold" data-testid="approval-banner-heading">
                      {isDebug ? (isStepped ? 'Paused — step mode' : 'Paused at breakpoint') : 'Awaiting your approval'}
                    </Text>
                  </Stack>
                  <Text size="small">
                    The step <Text weight="semibold">{pending.nodeTypeLabel || pending.nodeTypeID}</Text>{' '}
                    {isDebug ? 'is paused here' : 'wants to run'}
                    {pending.ruleLabel && !isDebug ? ` (rule: ${pending.ruleLabel})` : !isDebug ? ' (external steps ask by default)' : ''}.
                  </Text>
                  {pending.payload && (
                    <pre className={styles.result}>{pending.payload}</pre>
                  )}
                  <ApprovalValuesForm
                    attrs={attrsForPending(attrs, pending.inputAttributes)}
                    values={resumeValues[selectedRunID ?? ''] ?? {}}
                    onChange={(key, value) => setResumeValues((prev) => ({ ...prev, [selectedRunID ?? '']: { ...prev[selectedRunID ?? ''], [key]: value } }))}
                    label={isDebug ? 'Edit before resuming (optional)' : undefined}
                  />
                  <Stack direction="horizontal" gap="condensed">
                    {isDebug && isStepped && (
                      <Button size="small" variant="primary" disabled={busy} data-testid="step-step"
                        onClick={() => resolveApproval(pending.nodeID, true, false)}>
                        Step
                      </Button>
                    )}
                    {isDebug ? (
                      <Button size="small" variant={isStepped ? 'default' : 'primary'} disabled={busy} data-testid="resume-step"
                        onClick={() => resolveApproval(pending.nodeID, true, true)}>
                        {isStepped ? 'Continue' : 'Resume'}
                      </Button>
                    ) : (
                      <Button size="small" variant="primary" disabled={busy} data-testid="approve-step"
                        onClick={() => resolveApproval(pending.nodeID, true)}>
                        Approve and run
                      </Button>
                    )}
                    <Button size="small" variant="danger" disabled={busy} data-testid={isDebug ? 'stop-step' : 'deny-step'}
                      onClick={() => resolveApproval(pending.nodeID, false)}>
                      {isDebug ? 'Stop' : 'Deny'}
                    </Button>
                  </Stack>
                </Stack>
              </div>
            )
          })()}

          <Stack direction="vertical" gap="condensed" style={{ marginTop: 'var(--base-size-12)' }}>
            {(detail.steps ?? []).map((step) => (
              <Stack key={step.nodeID} direction="horizontal" justify="space-between" align="start" gap="condensed">
                <Stack direction="horizontal" gap="condensed" align="start">
                  <span className={styles.icon}>{STEP_ICON[step.status]}</span>
                  <div>
                    <Stack direction="horizontal" gap="condensed" align="center">
                      <Text size="small" weight="semibold">{step.nodeTypeLabel || step.nodeTypeID}</Text>
                      {/* A breakpoint/step-mode debug park reads distinctly
                          here too (docs/adr/0031 item 2) -- BugIcon, never
                          the guardrail shield/wording. */}
                      {step.guardrailSource === 'debug' && (
                        <Label variant="done" size="small" data-testid="step-debug-badge">
                          <BugIcon size={12} /> breakpoint
                        </Label>
                      )}
                    </Stack>
                    {step.guardrailEffect && (
                      <Text as="p" size="small" className={styles.muted} data-testid="step-guardrail">
                        Guardrail: {step.guardrailEffect}{step.guardrailRule ? ` (rule: ${step.guardrailRule})` : ''}
                      </Text>
                    )}
                    {step.output && <pre className={styles.result}>{step.output}</pre>}
                    {step.error && <Text as="p" size="small" className={styles.error}>{step.error}</Text>}
                  </div>
                </Stack>
                {/* "Retry", not "redrive": redrive is AWS-specific jargon
                    (SQS DLQ / Step Functions); the no-code space the owner
                    navigates by says Retry (n8n) / Replay (Zapier) /
                    Resubmit (Power Automate). Code-level RedriveRun/DBOS
                    fork naming is untouched -- ADR-0016's code-vs-UI
                    naming split, applied again (same class as the
                    "idempotency key" -> "Skip duplicate runs" rewrite). */}
                {step.status === 'failed' && (
                  <Button size="small" disabled={busy} onClick={() => redrive(step.nodeID)}>
                    Retry from this step
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
