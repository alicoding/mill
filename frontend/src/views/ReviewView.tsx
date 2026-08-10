import { useEffect, useState } from 'react'
import { Button, FormControl, Heading, Label, Stack, Text, TextInput } from '@primer/react'
import { ShieldIcon } from '@primer/octicons-react'
import * as ExecutionService from '../../bindings/github.com/alicoding/mill/executionservice'
import type { RunSummary } from '../../bindings/github.com/alicoding/mill/models'
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
  const [inputs, setInputs] = useState<Record<string, Record<string, string>>>({})
  const [error, setError] = useState('')

  const refresh = () => {
    ExecutionService.ListRuns()
      .then((runs) => setPending((runs ?? []).filter((r) => r.pending)))
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

  const attrsFor = (workflowID: string) =>
    workflows?.find((w) => w.ID === workflowID)?.Attributes ?? []

  return (
    <PageContainer data-testid="review-view">
      <Heading as="h1">Review</Heading>
      <Text as="p" className={styles.muted}>
        Runs paused for a human — guardrail approvals and Human review checkpoints across every
        workflow. Approve to resume (your input flows into the run), deny to stop it.
      </Text>
      {error && <Text as="p" size="small" className={styles.error}>{error}</Text>}

      {pending !== null && pending.length === 0 && (
        <div className={styles.empty} data-testid="review-empty">
          <Text as="p">Nothing waiting for you.</Text>
        </div>
      )}

      <Stack direction="vertical" gap="normal">
        {(pending ?? []).map((run) => (
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

              {attrsFor(run.workflowID).length > 0 && (
                <Stack direction="vertical" gap="condensed">
                  <Text size="small" weight="semibold">Your input (optional — flows into the resumed run)</Text>
                  {attrsFor(run.workflowID).map((a) => (
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
    </PageContainer>
  )
}

export default ReviewView
