import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Panel } from '@xyflow/react'
import { Button, IconButton, Stack, Text } from '@primer/react'
import { StatusStamp, type StatusStampVariant } from '../shared/StatusStamp'
import { AlertIcon, BugIcon, PlayIcon, ShieldIcon, SkipIcon, XIcon } from '@primer/octicons-react'
import type { AttributeDef, Workflow } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import type { RunDetail } from '../shared/bindings'
import { generateSamplePayload } from '../shared/configSchema'
import { ApprovalValuesForm, attrsForPending } from '../shared/ApprovalValuesForm'
import { CopyDiagnosisButton } from '../shared/CopyDiagnosisButton'
import TestRunDialog from './TestRunDialog'
import { workflowPayloadHint } from './triggerPayload'
import { type BarState, truncate } from './liveRunState'
import styles from './CompositionCanvas.module.css'
import runbookStyles from '../shared/ListCard.module.css'

// The component half of the canvas's live run state -- the context,
// hook, and types live in liveRunState.ts (split along the same
// component/non-component seam nodeKind.ts established, keeping React
// Fast Refresh's only-export-components rule intact). See that file's
// header comment for the full design rationale.

const FINISHED_VARIANT: Record<string, StatusStampVariant> = {
  SUCCESS: 'success',
  ERROR: 'danger',
  CANCELLED: 'neutral',
  MAX_RECOVERY_ATTEMPTS_EXCEEDED: 'danger',
}

// The bottom-center React Flow Panel showing "what's happening right
// now" for the run currently displayed on this canvas -- in flight,
// parked awaiting approval (with inline Approve/Deny, resolving through
// the same ExecutionService.ResolveApproval the Runs tab and Review
// queue use), or the finished outcome, dismissible. Renders nothing
// when no run is displayed.
export function CurrentStepBar({
  barState, attrs, runDetail, resolveErrorKey, onResolve, onDismiss,
}: {
  barState: BarState | null
  // The owning workflow's declared Attributes -- what a debug park's
  // edit-and-resume form (docs/adr/0031 item 4) offers to override.
  attrs: AttributeDef[]
  // The displayed run's full detail, for the finished bar's copyable
  // diagnosis context -- null for a pre-flight REFUSED start (no run
  // was ever created) and for every other bar mode.
  runDetail: RunDetail | null
  // The i18n key for a refused decision (liveRunState.ts's
  // resolveErrorKey), empty when the last decision landed -- rendered
  // inline under the parked bar's controls.
  resolveErrorKey: string
  onResolve: (nodeID: string, approve: boolean, continueRun?: boolean, values?: Record<string, string>) => void
  onDismiss: () => void
}) {
  const { t } = useTranslation('composition')
  const parkedNodeID = barState?.mode === 'parked' ? barState.pending.nodeID : null
  const [editValues, setEditValues] = useState<Record<string, string>>({})
  // A fresh park (a different node, or the same node on a later run)
  // starts with a clean edit form, not the previous park's leftover
  // values.
  useEffect(() => {
    setEditValues({})
  }, [parkedNodeID])

  if (!barState) return null
  return (
    <Panel position="bottom-center">
      <div className={styles.currentStepBar} data-testid="current-step-bar">
        {barState.mode === 'in-flight' && (
          <Stack direction="horizontal" gap="condensed" align="center">
            <Text size="small" className={styles.currentStepBarLabel}>{t('liveRunControls.currentStep')}</Text>
            <Text size="small" weight="semibold">{barState.activeStepLabel}</Text>
            <Text size="small" className={runbookStyles.muted}>{t('running')}</Text>
          </Stack>
        )}
        {barState.mode === 'parked' && (() => {
          // A breakpoint or step-mode park is a DEBUG park (docs/adr/0031)
          // -- distinct wording/icon from a policy ask, never the same
          // control set ("recognition, not confirmation"). A stepped
          // run's park additionally offers Step (advance one node,
          // keep stepping) alongside Continue (finish straight
          // through) -- a plain breakpoint only ever offers one resume
          // action, so Step is omitted there (nothing to "step to").
          const isDebug = barState.pending.source === 'debug'
          const isStepped = barState.pending.stepped
          return (
            <Stack direction="vertical" gap="condensed">
              <Stack direction="horizontal" gap="condensed" align="center">
                {isDebug ? <BugIcon size={16} fill="var(--fgColor-done)" /> : <ShieldIcon size={16} fill="var(--fgColor-attention)" />}
                <Text size="small" weight="semibold" data-testid="current-step-bar-label">
                  {isDebug
                    ? t('liveRunControls.pausedNodeLabel', { paused: isStepped ? t('pausedStepMode') : t('pausedAtBreakpoint'), node: barState.pending.nodeTypeLabel || barState.pending.nodeTypeID })
                    : t('liveRunControls.awaitingApprovalNodeLabel', { node: barState.pending.nodeTypeLabel || barState.pending.nodeTypeID })}
                </Text>
              </Stack>
              {barState.pending.payload && (
                <Text size="small" className={runbookStyles.muted}>{truncate(barState.pending.payload, 120)}</Text>
              )}
              {/* Edit-and-resume (docs/adr/0031 item 4), debug parks
                  only -- an ordinary policy ask isn't an authoring
                  surface for the run's own data. */}
              {isDebug && (
                <ApprovalValuesForm
                  attrs={attrsForPending(attrs, barState.pending.inputAttributes)}
                  values={editValues}
                  onChange={(key, value) => setEditValues((prev) => ({ ...prev, [key]: value }))}
                  label={t('editBeforeResuming')}
                />
              )}
              <Stack direction="horizontal" gap="condensed">
                {isDebug && isStepped && (
                  <Button
                    size="small"
                    variant="primary"
                    leadingVisual={SkipIcon}
                    data-testid="canvas-step"
                    onClick={() => onResolve(barState.pending.nodeID, true, false, editValues)}
                  >
                    {t('step')}
                  </Button>
                )}
                {isDebug ? (
                  <Button
                    size="small"
                    variant={isStepped ? 'default' : 'primary'}
                    leadingVisual={PlayIcon}
                    data-testid="canvas-resume-step"
                    onClick={() => onResolve(barState.pending.nodeID, true, true, editValues)}
                  >
                    {isStepped ? t('continue') : t('resume')}
                  </Button>
                ) : (
                  <Button
                    size="small"
                    variant="primary"
                    data-testid="canvas-approve-step"
                    onClick={() => onResolve(barState.pending.nodeID, true)}
                  >
                    {t('liveRunControls.approve')}
                  </Button>
                )}
                <Button
                  size="small"
                  variant="danger"
                  data-testid={isDebug ? 'canvas-stop-step' : 'canvas-deny-step'}
                  onClick={() => onResolve(barState.pending.nodeID, false)}
                >
                  {isDebug ? t('stop') : t('deny')}
                </Button>
              </Stack>
              {resolveErrorKey && (
                <Text as="p" className={runbookStyles.error} data-testid="canvas-resolve-error">{t(resolveErrorKey)}</Text>
              )}
            </Stack>
          )
        })()}
        {barState.mode === 'interrupted' && (
          <Stack direction="horizontal" gap="condensed" align="center">
            <AlertIcon size={16} fill="var(--fgColor-attention)" />
            <Text size="small" data-testid="current-step-bar-interrupted">{t('liveRunControls.interrupted')}</Text>
            <Button
              size="small"
              data-testid="dismiss-interrupted-run"
              onClick={onDismiss}
            >
              {t('liveRunControls.dismiss')}
            </Button>
          </Stack>
        )}
        {barState.mode === 'finished' && (
          <Stack direction="horizontal" gap="condensed" align="center">
            <StatusStamp variant={FINISHED_VARIANT[barState.status] ?? 'neutral'}>{barState.status}</StatusStamp>
            {barState.error && (
              <>
                <Text size="small" className={runbookStyles.error}>{truncate(barState.error, 120)}</Text>
                <CopyDiagnosisButton
                  error={barState.error}
                  context={{
                    Workflow: runDetail?.workflowLabel,
                    'Workflow ID': runDetail?.workflowID,
                    'Run ID': runDetail?.runID,
                    Started: runDetail?.startedAt,
                    Finished: runDetail?.completedAt,
                  }}
                  testId="canvas-run-copy-diagnosis"
                />
              </>
            )}
            <IconButton
              icon={XIcon}
              aria-label={t('liveRunControls.dismissRunStateAriaLabel')}
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
// run against yet. A second, adjacent "Step" entrypoint starts the
// SAME workflow in debug step mode instead (docs/adr/0031 §5) -- run
// menu variant, not a separate dialog flow: the attrs-check-then-
// dialog logic is identical, only the started run's mode differs.
export const RunButton = forwardRef<RunButtonHandle, {
  workflow: Workflow | null | undefined
  onStartRun: (values: Record<string, string>, stepped?: boolean, payload?: string) => void
}>(function RunButton({ workflow, onStartRun }, ref) {
  const { t } = useTranslation('composition')
  const [testRunOpen, setTestRunOpen] = useState(false)
  const [testRunStepped, setTestRunStepped] = useState(false)
  const [values, setValues] = useState<Record<string, string>>({})
  const [payload, setPayload] = useState('')

  // Hooks run unconditionally (before the null-workflow early return
  // below), same reason useImperativeHandle has to sit here rather than
  // after it -- React's own rules-of-hooks constraint, not a stylistic
  // choice. Memoized (not a plain `?? []`) so handleClick's own
  // useCallback identity below doesn't churn every render on a fresh
  // array reference.
  const attrs = useMemo(() => workflow?.Attributes ?? [], [workflow])
  // Non-null when this workflow's trigger normally supplies the run's
  // input (triggerPayload.ts) -- then the dialog opens even with zero
  // Attributes, so a test run isn't dead-on-arrival with an empty
  // payload (the saved-page seed's live failure).
  const payloadHint = useMemo(() => workflowPayloadHint(workflow), [workflow])

  const handleClick = useCallback((stepped: boolean) => {
    if (!workflow) return
    if (attrs.length > 0 || payloadHint) {
      setValues(generateSamplePayload(attrs))
      setPayload('')
      setTestRunStepped(stepped)
      setTestRunOpen(true)
      return
    }
    onStartRun({}, stepped)
  }, [workflow, attrs, payloadHint, onStartRun])

  useImperativeHandle(ref, () => ({ trigger: () => handleClick(false) }), [handleClick])

  if (!workflow) return null

  return (
    <>
      <Button
        variant="primary"
        size="small"
        onClick={() => handleClick(false)}
        data-testid="canvas-run"
        title={t('liveRunControls.runButtonTooltip')}
      >
        {t('liveRunControls.run')}
      </Button>
      <IconButton
        icon={BugIcon}
        aria-label={t('liveRunControls.runInStepModeAriaLabel')}
        size="small"
        data-testid="canvas-run-stepped"
        title={t('liveRunControls.runInStepModeTooltip')}
        onClick={() => handleClick(true)}
      />
      {testRunOpen && (
        <TestRunDialog
          workflowLabel={workflow.Label}
          attributes={attrs}
          values={values}
          onChange={(key, value) => setValues((prev) => ({ ...prev, [key]: value }))}
          payloadHint={payloadHint}
          payload={payload}
          onPayloadChange={setPayload}
          onCancel={() => setTestRunOpen(false)}
          onRun={() => {
            onStartRun(values, testRunStepped, payload)
            setTestRunOpen(false)
          }}
        />
      )}
    </>
  )
})
