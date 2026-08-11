import { useEffect, useState } from 'react'
import { Button, Heading, Label, Select, Stack, Text } from '@primer/react'
import { BugIcon, ShieldIcon } from '@primer/octicons-react'
import { ExecutionService } from '../shared/bindings'
import type { RunSummary } from '../shared/bindings'
import { ApprovalValuesForm, attrsForPending } from '../shared/ApprovalValuesForm'
import { useAppStore } from '../shared/store'
import { formatRunStartedAt } from '../shared/runTime'
import styles from '../shared/ListCard.module.css'
import PageContainer from '../shared/PageContainer'

// The Review queue (docs/adr/0023, §3.2's case-management-style
// "Review" surface in v1 form): every parked run across every workflow
// -- ambient guardrail asks and Human review checkpoints alike, since
// they share one pending mechanism -- in one inbox. A reviewer sees
// exactly what wants to run (§1's what-you-see-is-what-I-see thesis),
// can fill typed input for the workflow's declared Attributes (flows
// into the resumed run), and approves or denies. Composed from the
// already-built parked-run data (ListRuns + pending), deliberately not
// a case-management engine (no assignment/SLA/notes -- the
// Camunda/Pega line, not crossed).
function ReviewView() {
  const workflows = useAppStore((s) => s.workflows)
  const requestOpenWorkflow = useAppStore((s) => s.requestOpenWorkflow)
  const [pending, setPending] = useState<RunSummary[] | null>(null)
  const [resolved, setResolved] = useState<RunSummary[]>([])
  const [inputs, setInputs] = useState<Record<string, Record<string, string>>>({})
  const [workflowFilter, setWorkflowFilter] = useState('')
  const [error, setError] = useState('')

  const refresh = () => {
    ExecutionService.ListRuns()
      .then((runs) => {
        setPending((runs ?? []).filter((r) => r.pending))
        // Recently resolved: runs that once parked, newest first --
        // the queue's after-the-fact visibility (goal 0002), same
        // event the park wrote, read after resolution.
        setResolved((runs ?? []).filter((r) => r.resolution))
      })
      .catch((err) => setError(String(err)))
  }

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 2000)
    return () => clearInterval(timer)
  }, [])

  // continueRun stays false uniformly (docs/adr/0031 §5): Review's two-
  // button UI has no dedicated Step/Continue distinction, so a plain
  // Approve on a STEPPED run's park behaves like "Step" (advance one
  // node, park again) -- the safe default that never silently skips
  // step mode. A user who wants full Step/Continue/Stop control over a
  // stepped run uses the canvas's own CurrentStepBar instead.
  const resolve = (run: RunSummary, approve: boolean) => {
    if (!run.pending) return
    setError('')
    ExecutionService.ResolveApproval(run.runID, run.pending.nodeID, approve, approve ? (inputs[run.runID] ?? {}) : {}, false)
      .then(() => setTimeout(refresh, 700))
      .catch((err) => setError(String(err)))
  }

  // Row drill-down (docs/goals/0002-review-queue-maturation.md item 5):
  // every Review row -- pending or resolved -- opens its run in the
  // app-wide work-tab shell at the workflow's Runs inner tab, with that
  // run's own detail already open. ONE run-detail viewer (docs/SPEC.md
  // §7's lock) -- Review itself never renders run detail.
  const openRun = (run: RunSummary) => requestOpenWorkflow(run.workflowID, run.runID)

  const attrsFor = (run: RunSummary) => attrsForPending(workflows?.find((w) => w.ID === run.workflowID)?.Attributes ?? [], run.pending?.inputAttributes)

  // A breakpoint/step-mode debug park (docs/adr/0031) reads distinctly
  // here too -- never the same badge/wording as a policy ask ("recognition,
  // not confirmation").
  const isDebugPark = (run: RunSummary) => run.pending?.source === 'debug'

  return (
    <PageContainer data-testid="review-view">
      <Heading as="h1">Review</Heading>
      <Text as="p" className={styles.muted}>
        Runs paused for a human — guardrail approvals and Human review checkpoints across every
        workflow. Approve to resume (your input flows into the run), deny to stop it.
      </Text>
      {error && <Text as="p" size="small" className={styles.error}>{error}</Text>}

      {((pending?.length ?? 0) > 0 || resolved.length > 0) && (
        <Stack direction="horizontal" gap="condensed" align="center">
          <Select value={workflowFilter} onChange={(e) => setWorkflowFilter(e.target.value)} aria-label="Filter by workflow">
            <Select.Option value="">All workflows</Select.Option>
            {[...new Set([...(pending ?? []), ...resolved].map((r) => r.workflowID))].map((id) => (
              <Select.Option key={id} value={id}>
                {workflows?.find((w) => w.ID === id)?.Label ?? id}
              </Select.Option>
            ))}
          </Select>
        </Stack>
      )}

      {pending !== null && pending.length === 0 && (
        <div className={styles.empty} data-testid="review-empty">
          <Text as="p">Nothing waiting for you.</Text>
        </div>
      )}

      <Stack direction="vertical" gap="normal">
        {(pending ?? []).filter((r) => !workflowFilter || r.workflowID === workflowFilter).map((run) => (
          <div
            key={run.runID}
            className={`${styles.card} ${styles.activityRowClickable}`}
            data-testid="review-item"
            onClick={() => openRun(run)}
          >
            <Stack direction="vertical" gap="condensed">
              <Stack direction="horizontal" gap="condensed" align="center">
                {isDebugPark(run) ? <BugIcon size={16} /> : <ShieldIcon size={16} />}
                <Text weight="semibold">{run.workflowLabel}</Text>
                <Label variant={isDebugPark(run) ? 'done' : 'attention'} size="small" data-testid={isDebugPark(run) ? 'review-debug-badge' : undefined}>
                  {isDebugPark(run) ? (run.pending?.stepped ? 'paused — step mode' : 'paused at breakpoint') : 'awaiting approval'}
                </Label>
                <Text size="small" className={styles.muted}>{formatRunStartedAt(run.startedAt)}</Text>
              </Stack>
              <Text size="small">
                Step <Text weight="semibold">{run.pending?.nodeTypeLabel || run.pending?.nodeTypeID}</Text>
                {run.pending?.ruleLabel ? ` — ${run.pending.ruleLabel}` : ' — external steps ask by default'}
              </Text>
              {run.pending?.payload && <pre className={styles.result}>{run.pending.payload}</pre>}

              {/* stopPropagation on this whole interactive block: the
                  card itself now opens the run (row drill-down, goal
                  0002 item 5) -- typing input or clicking Approve/Deny
                  must not also trigger that navigation. */}
              <ApprovalValuesForm
                attrs={attrsFor(run)}
                values={inputs[run.runID] ?? {}}
                onChange={(key, value) => setInputs((prev) => ({ ...prev, [run.runID]: { ...prev[run.runID], [key]: value } }))}
              />

              <Stack direction="horizontal" gap="condensed" onClick={(e) => e.stopPropagation()}>
                <Button size="small" variant="primary" data-testid="review-approve" onClick={() => resolve(run, true)}>
                  {isDebugPark(run) ? 'Resume' : 'Approve and resume'}
                </Button>
                <Button size="small" variant="danger" data-testid="review-deny" onClick={() => resolve(run, false)}>
                  {isDebugPark(run) ? 'Stop' : 'Deny'}
                </Button>
              </Stack>
            </Stack>
          </div>
        ))}
      </Stack>
      {resolved.filter((r) => !workflowFilter || r.workflowID === workflowFilter).length > 0 && (
        <>
          <Heading as="h2" variant="small" className={styles.sectionHeading}>Recently resolved</Heading>
          <Stack direction="vertical" gap="condensed">
            {resolved.filter((r) => !workflowFilter || r.workflowID === workflowFilter).slice(0, 10).map((run) => (
              <div
                key={run.runID}
                className={`${styles.card} ${styles.activityRowClickable}`}
                data-testid="review-resolved-item"
                onClick={() => openRun(run)}
              >
                <Stack direction="horizontal" gap="condensed" align="center" justify="space-between">
                  <Stack direction="horizontal" gap="condensed" align="center">
                    <Text weight="semibold">{run.workflowLabel}</Text>
                    <Label
                      size="small"
                      variant={run.resolution === 'approved' ? 'success' : 'danger'}
                      data-testid="review-resolution"
                    >
                      {run.resolution}
                    </Label>
                    <Label size="small" variant={run.status === 'SUCCESS' ? 'success' : 'secondary'}>{run.status}</Label>
                  </Stack>
                  <Text size="small" className={styles.muted}>{formatRunStartedAt(run.startedAt)}</Text>
                </Stack>
              </div>
            ))}
          </Stack>
        </>
      )}
    </PageContainer>
  )
}

export default ReviewView
