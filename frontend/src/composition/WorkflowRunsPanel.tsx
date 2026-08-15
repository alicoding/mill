import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Events } from '@wailsio/runtime'
import { Button, IconButton, Select, Stack, Text } from '@primer/react'
import { DataTable, type Column } from '@primer/react/experimental'
import { Blankslate } from '@primer/react/experimental'
import { BugIcon, CheckCircleIcon, XCircleIcon, ClockIcon, XIcon, ShieldIcon, ShieldXIcon, StopIcon, HistoryIcon } from '@primer/octicons-react'
import { ExecutionService } from '../shared/bindings'
import { RunKind, type RunDetail, type RunSummary } from '../shared/bindings'
import type { AttributeDef } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { ApprovalValuesForm, attrsForPending } from '../shared/ApprovalValuesForm'
import { formatRunStartedAt, runStatusVariant } from '../shared/runTime'
import { StalenessBadge } from '../shared/StalenessBadge'
import { StatusStamp, type StatusStampVariant } from '../shared/StatusStamp'
import { ENQUEUED_STALE_THRESHOLD_MS, isStuckEnqueued } from '../shared/enqueuedStale'
import styles from '../shared/ListCard.module.css'
import monoStyles from '../shared/monoText.module.css'
import PageContainer from '../shared/PageContainer'

function kindLabelFor(t: (key: string) => string): Record<RunKind, string> {
  return {
    [RunKind.$zero]: t('workflowRunsPanel.kindLabel.test'), // pre-docs/adr/0008 runs recorded before Kind existed default to "test" server-side (executionservice.go)
    [RunKind.RunKindTest]: t('workflowRunsPanel.kindLabel.test'),
    [RunKind.RunKindTriggered]: t('workflowRunsPanel.kindLabel.triggered'),
    // RunKindMCP: an external MCP client's run_workflow with test:false
    // (goal 0021 Phase 3 gap 2) -- a real production run, same as
    // "triggered", just started by an agent instead of a headless
    // listener.
    [RunKind.RunKindMCP]: t('workflowRunsPanel.kindLabel.mcp'),
  }
}

// All neutral -- "how did this run start" is categorization, not a
// status verdict, so it doesn't earn either of the semantic colors
// (the old severe/orange on `triggered` read as a warning it wasn't).
const KIND_VARIANT: Record<RunKind, StatusStampVariant> = {
  [RunKind.$zero]: 'neutral',
  [RunKind.RunKindTest]: 'neutral',
  [RunKind.RunKindTriggered]: 'neutral',
  [RunKind.RunKindMCP]: 'neutral',
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
  // The empty state's own primary action: switches this same editor tab
  // to its Canvas inner tab (WorkflowEditorTab owns that switch; Canvas
  // is the one Run entrypoint, docs/adr/0008).
  onSwitchToCanvas: () => void
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
function WorkflowRunsPanel({ workflowId, attrs, initialRunId, onInitialRunConsumed, onSwitchToCanvas }: WorkflowRunsPanelProps) {
  const { t } = useTranslation('composition')
  const KIND_LABEL = kindLabelFor(t)
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

  // goal 0017 P1-2: this tab's base run list used to update only on
  // mount/workflow-switch -- a run started elsewhere (another tab, a
  // headless trigger, an MCP author's run_workflow) never appeared here
  // without reopening the tab. mill-data-changed{entity:"run"} fires at
  // run start (executionsvc runWorkflowStart) and run completion
  // (executionsvc runWorkflow) for every run kind, plus the MCP debug
  // tools; executionsvc's own emits are pinned by
  // TestRunWorkflow_EmitsRunDataEventOnStartAndCompletion, since this
  // panel stays mounted across section-tab switches and a missing emit
  // leaves it stale until a full reload. The in-flight-run detail poll
  // above stays -- DBOS has no per-step event, so polling an
  // already-open run's own step-by-step progress is still the honest
  // only-path.
  useEffect(() => {
    return Events.On('mill-data-changed', (evt) => {
      const entity = (evt.data as { entity?: string })?.entity
      if (entity === 'run') refreshRuns()
    })
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
    const timer = setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 150)
    return () => clearTimeout(timer)
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
      header: t('workflowRunsPanel.columns.status'),
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
          <Stack direction="horizontal" gap="condensed" align="center">
            {run.pending ? (
              <StatusStamp variant="caution" data-testid="run-awaiting-approval">{t('workflowRunsPanel.awaitingApproval')}</StatusStamp>
            ) : (
              <StatusStamp variant={runStatusVariant(run.status)}>{run.status}</StatusStamp>
            )}
            {/* Stuck-ENQUEUED presentation (docs/goals/0026 item 8): a
                run that queued forever without ever starting reads as
                live otherwise -- age emphasis, same tier language as
                the pending-approval staleness treatment (item 2), at
                its own 5-minute bar. No "expires in" caption -- an
                ENQUEUED run has no 24h clock of its own. */}
            {isStuckEnqueued(run) && (
              <StalenessBadge
                createdAt={run.startedAt}
                thresholdMs={ENQUEUED_STALE_THRESHOLD_MS}
                showExpiry={false}
                testId="run-enqueued-stale"
              />
            )}
          </Stack>
        </span>
      ),
    },
    {
      id: 'kind',
      header: t('workflowRunsPanel.columns.kind'),
      field: 'kind',
      sortBy: 'alphanumeric',
      renderCell: (run) => <StatusStamp variant={KIND_VARIANT[run.kind]}>{KIND_LABEL[run.kind]}</StatusStamp>,
    },
    {
      id: 'started',
      header: t('workflowRunsPanel.columns.started'),
      field: 'startedAt',
      sortBy: 'datetime',
      renderCell: (run) => <Text size="small" className={`${styles.muted} ${monoStyles.mono}`}>{formatRunStartedAt(run.startedAt)}</Text>,
    },
  ]

  return (
    <PageContainer data-testid="workflow-runs-panel">
      <Stack direction="horizontal" gap="condensed" align="center" className={styles.filterRow}>
        <Select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as 'all' | RunKind)} aria-label={t('workflowRunsPanel.filterByKindAriaLabel')}>
          <Select.Option value="all">{t('workflowRunsPanel.allKinds')}</Select.Option>
          <Select.Option value={RunKind.RunKindTest}>{t('workflowRunsPanel.test')}</Select.Option>
          <Select.Option value={RunKind.RunKindTriggered}>{t('workflowRunsPanel.triggered')}</Select.Option>
          <Select.Option value={RunKind.RunKindMCP}>{t('workflowRunsPanel.mcp')}</Select.Option>
        </Select>
      </Stack>

      {error && <Text as="p" className={styles.error}>{error}</Text>}

      {runs === null && (
        <div className={styles.empty}><Text as="p">{t('loading')}</Text></div>
      )}

      {/* Design-wave-1 fix #7: was a bare centered line of text -- the
          same Blankslate (icon + one-line invitation) pattern
          ReviewView's "Nothing waiting for you" empty state already
          uses, so Runs reads at the same quality bar. */}
      {runs !== null && runs.length === 0 && (
        <Blankslate data-testid="workflow-runs-empty">
          <Blankslate.Visual>
            <HistoryIcon size={32} />
          </Blankslate.Visual>
          <Blankslate.Heading>{t('workflowRunsPanel.noRunsYet')}</Blankslate.Heading>
          <Blankslate.Description>{t('workflowRunsPanel.noRunsYetDescription')}</Blankslate.Description>
          <Blankslate.PrimaryAction onClick={onSwitchToCanvas}>
            {t('workflowRunsPanel.goToCanvas')}
          </Blankslate.PrimaryAction>
        </Blankslate>
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
              <StatusStamp variant={runStatusVariant(detail.status)}>{detail.status}</StatusStamp>
              {isStuckEnqueued(detail) && (
                <StalenessBadge
                  createdAt={detail.startedAt}
                  thresholdMs={ENQUEUED_STALE_THRESHOLD_MS}
                  showExpiry={false}
                  testId="run-detail-enqueued-stale"
                />
              )}
              {/* The run's own identity, so two identical-outcome runs
                  are still tellable apart in the detail header -- the
                  other half of the selected-row fix above. */}
              <Text size="small" weight="semibold" data-testid="run-detail-identity">
                {t('workflowRunsPanel.runIdentity', { started: formatRunStartedAt(detail.startedAt) })}
              </Text>
            </Stack>
            <Stack direction="horizontal" gap="condensed" align="center">
              {(detail.status === 'PENDING' || detail.status === 'RUNNING' || detail.status === 'ENQUEUED') && (
                <Button
                  size="small" variant="danger" leadingVisual={StopIcon} disabled={busy}
                  data-testid="cancel-run" onClick={cancelRun}
                >
                  {t('stop')}
                </Button>
              )}
              <IconButton icon={XIcon} aria-label={t('workflowRunsPanel.closeAriaLabel')} size="small" variant="invisible" onClick={() => setSelectedRunID(null)} />
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
                      {isDebug ? (isStepped ? t('pausedStepMode') : t('pausedAtBreakpoint')) : t('workflowRunsPanel.awaitingYourApproval')}
                    </Text>
                  </Stack>
                  <Text size="small">
                    {t('workflowRunsPanel.theStepPrefix')} <Text weight="semibold">{pending.nodeTypeLabel || pending.nodeTypeID}</Text>{' '}
                    {isDebug ? t('workflowRunsPanel.stepIsPausedHere') : t('workflowRunsPanel.stepWantsToRun')}
                    {pending.ruleLabel && !isDebug ? t('workflowRunsPanel.ruleSuffix', { rule: pending.ruleLabel }) : !isDebug ? t('workflowRunsPanel.externalStepsAskByDefault') : ''}.
                  </Text>
                  {pending.payload && (
                    <pre className={styles.result}>{pending.payload}</pre>
                  )}
                  <ApprovalValuesForm
                    attrs={attrsForPending(attrs, pending.inputAttributes)}
                    values={resumeValues[selectedRunID ?? ''] ?? {}}
                    onChange={(key, value) => setResumeValues((prev) => ({ ...prev, [selectedRunID ?? '']: { ...prev[selectedRunID ?? ''], [key]: value } }))}
                    label={isDebug ? t('editBeforeResuming') : undefined}
                  />
                  <Stack direction="horizontal" gap="condensed">
                    {isDebug && isStepped && (
                      <Button size="small" variant="primary" disabled={busy} data-testid="step-step"
                        onClick={() => resolveApproval(pending.nodeID, true, false)}>
                        {t('step')}
                      </Button>
                    )}
                    {isDebug ? (
                      <Button size="small" variant={isStepped ? 'default' : 'primary'} disabled={busy} data-testid="resume-step"
                        onClick={() => resolveApproval(pending.nodeID, true, true)}>
                        {isStepped ? t('continue') : t('resume')}
                      </Button>
                    ) : (
                      <Button size="small" variant="primary" disabled={busy} data-testid="approve-step"
                        onClick={() => resolveApproval(pending.nodeID, true)}>
                        {t('workflowRunsPanel.approveAndRun')}
                      </Button>
                    )}
                    <Button size="small" variant="danger" disabled={busy} data-testid={isDebug ? 'stop-step' : 'deny-step'}
                      onClick={() => resolveApproval(pending.nodeID, false)}>
                      {isDebug ? t('stop') : t('deny')}
                    </Button>
                  </Stack>
                </Stack>
              </div>
            )
          })()}

          <Stack direction="vertical" gap="condensed" style={{ marginTop: 'var(--base-size-12)' }}>
            {(detail.steps ?? []).map((step) => (
              <Stack key={step.nodeID} direction="horizontal" justify="space-between" align="start" gap="condensed"
                data-testid="run-step" data-node-type-id={step.nodeTypeID}>
                <Stack direction="horizontal" gap="condensed" align="start">
                  <span className={styles.icon}>{STEP_ICON[step.status]}</span>
                  <div>
                    <Stack direction="horizontal" gap="condensed" align="center">
                      <Text size="small" weight="semibold">{step.nodeTypeLabel || step.nodeTypeID}</Text>
                      {/* A breakpoint/step-mode debug park reads distinctly
                          here too (docs/adr/0031 item 2) -- BugIcon, never
                          the guardrail shield/wording. */}
                      {step.guardrailSource === 'debug' && (
                        <StatusStamp variant="identity" data-testid="step-debug-badge">
                          <BugIcon size={12} /> {t('workflowRunsPanel.breakpointBadge')}
                        </StatusStamp>
                      )}
                    </Stack>
                    {step.guardrailEffect && (
                      <Text as="p" size="small" className={styles.muted} data-testid="step-guardrail">
                        {t('workflowRunsPanel.guardrailLabel', { effect: step.guardrailEffect, ruleSuffix: step.guardrailRule ? t('workflowRunsPanel.ruleSuffix', { rule: step.guardrailRule }) : '' })}
                      </Text>
                    )}
                    {step.output && <pre className={styles.result}>{step.output}</pre>}
                    {step.error && <Text as="p" size="small" className={styles.error}>{step.error}</Text>}
                  </div>
                </Stack>
                {/* "Retry", not "redrive": redrive is AWS-specific jargon
                    (SQS DLQ / Step Functions); the no-code space this
                    product competes in says Retry (n8n) / Replay (Zapier) /
                    Resubmit (Power Automate). Code-level RedriveRun/DBOS
                    fork naming is untouched -- ADR-0016's code-vs-UI
                    naming split, applied again (same class as the
                    "idempotency key" -> "Skip duplicate runs" rewrite). */}
                {step.status === 'failed' && (
                  <Button size="small" disabled={busy} onClick={() => redrive(step.nodeID)}>
                    {t('workflowRunsPanel.retryFromThisStep')}
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
