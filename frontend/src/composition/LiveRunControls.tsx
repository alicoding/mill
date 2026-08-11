import { forwardRef, useCallback, useImperativeHandle, useMemo, useState } from 'react'
import { Panel } from '@xyflow/react'
import { Button, IconButton, Label, type LabelProps, Stack, Text } from '@primer/react'
import { ShieldIcon, XIcon } from '@primer/octicons-react'
import type { Workflow } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { generateSamplePayload } from '../shared/configSchema'
import TestRunDialog from './TestRunDialog'
import { type BarState, truncate } from './liveRunState'
import styles from './CompositionCanvas.module.css'
import runbookStyles from '../shared/ListCard.module.css'

// The component half of the canvas's live run state -- the context,
// hook, and types live in liveRunState.ts (split along the same
// component/non-component seam nodeKind.ts established, keeping React
// Fast Refresh's only-export-components rule intact). See that file's
// header comment for the full design rationale.

const FINISHED_VARIANT: Record<string, LabelProps['variant']> = {
  SUCCESS: 'success',
  ERROR: 'danger',
  CANCELLED: 'secondary',
  MAX_RECOVERY_ATTEMPTS_EXCEEDED: 'danger',
}

// The bottom-center React Flow Panel showing "what's happening right
// now" for the run currently displayed on this canvas -- in flight,
// parked awaiting approval (with inline Approve/Deny, resolving through
// the same ExecutionService.ResolveApproval the Runs tab and Review
// queue use), or the finished outcome, dismissible. Renders nothing
// when no run is displayed.
export function CurrentStepBar({
  barState, onResolve, onDismiss,
}: {
  barState: BarState | null
  onResolve: (nodeID: string, approve: boolean) => void
  onDismiss: () => void
}) {
  if (!barState) return null
  return (
    <Panel position="bottom-center">
      <div className={styles.currentStepBar} data-testid="current-step-bar">
        {barState.mode === 'in-flight' && (
          <Stack direction="horizontal" gap="condensed" align="center">
            <Text size="small" className={styles.currentStepBarLabel}>Current step</Text>
            <Text size="small" weight="semibold">{barState.activeStepLabel}</Text>
            <Text size="small" className={runbookStyles.muted}>Running…</Text>
          </Stack>
        )}
        {barState.mode === 'parked' && (
          <Stack direction="vertical" gap="condensed">
            <Stack direction="horizontal" gap="condensed" align="center">
              <ShieldIcon size={16} fill="var(--fgColor-attention)" />
              <Text size="small" weight="semibold">
                Awaiting approval: {barState.pending.nodeTypeLabel || barState.pending.nodeTypeID}
              </Text>
            </Stack>
            {barState.pending.payload && (
              <Text size="small" className={runbookStyles.muted}>{truncate(barState.pending.payload, 120)}</Text>
            )}
            <Stack direction="horizontal" gap="condensed">
              <Button
                size="small"
                variant="primary"
                data-testid="canvas-approve-step"
                onClick={() => onResolve(barState.pending.nodeID, true)}
              >
                Approve
              </Button>
              <Button
                size="small"
                variant="danger"
                data-testid="canvas-deny-step"
                onClick={() => onResolve(barState.pending.nodeID, false)}
              >
                Deny
              </Button>
            </Stack>
          </Stack>
        )}
        {barState.mode === 'finished' && (
          <Stack direction="horizontal" gap="condensed" align="center">
            <Label variant={FINISHED_VARIANT[barState.status] ?? 'secondary'} size="small">{barState.status}</Label>
            {barState.error && (
              <Text size="small" className={runbookStyles.error}>{truncate(barState.error, 120)}</Text>
            )}
            <IconButton
              icon={XIcon}
              aria-label="Dismiss run state"
              size="small"
              variant="invisible"
              data-testid="dismiss-run-state"
              onClick={onDismiss}
            />
          </Stack>
        )}
      </div>
    </Panel>
  )
}

// Exposed so the canvas's workflow.run command (docs/goals/0016-keymap-
// system.md, shared/commands.ts) can trigger exactly the same
// attrs-check-then-dialog-or-immediate-run logic a mouse click on the
// button already runs, without lifting testRunOpen/values state out of
// this component -- CompositionCanvas.tsx holds a ref and calls
// `.trigger()` from its own canvasCommandRequest-consuming effect.
export interface RunButtonHandle {
  trigger: () => void
}

// The canvas's own Run entrypoint (docs/adr/0008's single execution
// path, docs/SPEC.md §3.2's per-record test harness reused verbatim
// from CompositionView.tsx/TestRunDialog): a workflow with declared
// Attributes opens the same test-input dialog the Workflows list's own
// Run button opens; one with none runs immediately. Only rendered once
// a workflow is saved -- a brand-new, not-yet-saved draft has no ID to
// run against yet.
export const RunButton = forwardRef<RunButtonHandle, {
  workflow: Workflow | null | undefined
  onStartRun: (values: Record<string, string>) => void
}>(function RunButton({ workflow, onStartRun }, ref) {
  const [testRunOpen, setTestRunOpen] = useState(false)
  const [values, setValues] = useState<Record<string, string>>({})

  // Hooks run unconditionally (before the null-workflow early return
  // below), same reason useImperativeHandle has to sit here rather than
  // after it -- React's own rules-of-hooks constraint, not a stylistic
  // choice. Memoized (not a plain `?? []`) so handleClick's own
  // useCallback identity below doesn't churn every render on a fresh
  // array reference.
  const attrs = useMemo(() => workflow?.Attributes ?? [], [workflow])

  const handleClick = useCallback(() => {
    if (!workflow) return
    if (attrs.length > 0) {
      setValues(generateSamplePayload(attrs))
      setTestRunOpen(true)
      return
    }
    onStartRun({})
  }, [workflow, attrs, onStartRun])

  useImperativeHandle(ref, () => ({ trigger: handleClick }), [handleClick])

  if (!workflow) return null

  return (
    <>
      <Button
        variant="primary"
        size="small"
        onClick={handleClick}
        data-testid="canvas-run"
        title="Runs the saved draft (test run)."
      >
        Run
      </Button>
      {testRunOpen && (
        <TestRunDialog
          workflowLabel={workflow.Label}
          attributes={attrs}
          values={values}
          onChange={(key, value) => setValues((prev) => ({ ...prev, [key]: value }))}
          onCancel={() => setTestRunOpen(false)}
          onRun={() => {
            onStartRun(values)
            setTestRunOpen(false)
          }}
        />
      )}
    </>
  )
})
