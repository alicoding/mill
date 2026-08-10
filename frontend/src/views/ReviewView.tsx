import { useEffect, useState } from 'react'
import { Button, FormControl, Heading, Label, Select, Stack, Text, TextInput } from '@primer/react'
import { ShieldIcon } from '@primer/octicons-react'
import { ExecutionService } from '../shared/bindings'
import type { RunSummary } from '../shared/bindings'
import { useAppStore } from '../shared/store'
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

  const resolve = (run: RunSummary, approve: boolean) => {
    if (!run.pending) return
    setError('')
    ExecutionService.ResolveApproval(run.runID, run.pending.nodeID, approve, approve ? (inputs[run.runID] ?? {}) : {})
      .then(() => setTimeout(refresh, 700))
      .catch((err) => setError(String(err)))
  }

  const attrsFor = (run: RunSummary) => {
    const all = workflows?.find((w) => w.ID === run.workflowID)?.Attributes ?? []
    const requested = run.pending?.inputAttributes ?? []
    // A human-review step can name a subset of attributes to ask for
    // (goal 0001); empty means all, the prior behavior.
    return requested.length > 0 ? all.filter((a) => requested.includes(a.Key)) : all
  }

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
          <div key={run.runID} className={styles.card} data-testid="review-item">
            <Stack direction="vertical" gap="condensed">
              <Stack direction="horizontal" gap="condensed" align="center">
                <ShieldIcon size={16} />
                <Text weight="semibold">{run.workflowLabel}</Text>
                <Label variant="attention" size="small">awaiting approval</Label>
                <Text size="small" className={styles.muted}>{new Date(run.startedAt).toLocaleString()}</Text>
              </Stack>
              <Text size="small">
                Step <Text weight="semibold">{run.pending?.nodeTypeLabel || run.pending?.nodeTypeID}</Text>
                {run.pending?.ruleLabel ? ` — ${run.pending.ruleLabel}` : ' — external steps ask by default'}
              </Text>
              {run.pending?.payload && <pre className={styles.result}>{run.pending.payload}</pre>}

              {attrsFor(run).length > 0 && (
                <Stack direction="vertical" gap="condensed">
                  <Text size="small" weight="semibold">Your input (optional — flows into the resumed run)</Text>
                  {attrsFor(run).map((a) => (
                    <FormControl key={a.Key}>
                      <FormControl.Label>{a.Label || a.Key}</FormControl.Label>
                      <TextInput
                        size="small"
                        value={inputs[run.runID]?.[a.Key] ?? ''}
                        placeholder="leave empty to keep the current value"
                        onChange={(e) => setInputs((prev) => ({
                          ...prev,
                          [run.runID]: { ...prev[run.runID], [a.Key]: e.target.value },
                        }))}
                      />
                    </FormControl>
                  ))}
                </Stack>
              )}

              <Stack direction="horizontal" gap="condensed">
                <Button size="small" variant="primary" data-testid="review-approve" onClick={() => resolve(run, true)}>
                  Approve and resume
                </Button>
                <Button size="small" variant="danger" data-testid="review-deny" onClick={() => resolve(run, false)}>
                  Deny
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
              <div key={run.runID} className={styles.card} data-testid="review-resolved-item">
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
                  <Text size="small" className={styles.muted}>{new Date(run.startedAt).toLocaleString()}</Text>
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
