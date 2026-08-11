import { Stack, Text } from '@primer/react'
import type { RunStep } from '../shared/bindings'
import styles from '../shared/ListCard.module.css'

// Per-step input/output data for the node currently selected on the
// live-run canvas (docs/adr/0031 items 3/5: "clicking any executed/
// paused node shows that step's input and output for the selected
// run"). Deliberately plain rendering -- the richer shared typed-tree
// component (docs/SPEC.md §3.2) is a separate, not-yet-built capability
// this doesn't try to invent one-off.
export function NodeExecutionSection({ step }: { step: RunStep | undefined }) {
  if (!step) return null
  const hasInputAttrs = step.inputAttributes && Object.keys(step.inputAttributes).length > 0
  const hasOutputAttrs = step.outputAttributes && Object.keys(step.outputAttributes).length > 0
  if (!step.input && !hasInputAttrs && !step.output && !hasOutputAttrs) return null
  return (
    <Stack direction="vertical" gap="condensed" data-testid="node-execution-section">
      <Text size="small" weight="semibold">This run's step data</Text>
      {(step.input || hasInputAttrs) && (
        <Stack direction="vertical" gap="condensed">
          <Text size="small" className={styles.muted}>Input</Text>
          {step.input && <pre className={styles.result} data-testid="node-execution-input">{step.input}</pre>}
          {hasInputAttrs && (
            <pre className={styles.result} data-testid="node-execution-input-attrs">{JSON.stringify(step.inputAttributes, null, 2)}</pre>
          )}
        </Stack>
      )}
      {(step.output || hasOutputAttrs) && (
        <Stack direction="vertical" gap="condensed">
          <Text size="small" className={styles.muted}>Output</Text>
          {step.output && <pre className={styles.result} data-testid="node-execution-output">{step.output}</pre>}
          {hasOutputAttrs && (
            <pre className={styles.result} data-testid="node-execution-output-attrs">{JSON.stringify(step.outputAttributes, null, 2)}</pre>
          )}
        </Stack>
      )}
    </Stack>
  )
}
