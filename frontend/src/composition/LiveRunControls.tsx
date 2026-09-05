import { forwardRef, useCallback, useImperativeHandle, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionList, ActionMenu, Button, ButtonGroup, IconButton } from '@primer/react'
import { BugIcon, TriangleDownIcon } from '@primer/octicons-react'
import type { Workflow } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { generateSamplePayload } from '../shared/configSchema'
import TestRunDialog from './TestRunDialog'
import { workflowPayloadHint } from './triggerPayload'

// The canvas's Run entry point. The dock reporting what a started run is
// doing lives in RunStateDock.tsx; the polled state and types behind
// both live in liveRunState.ts (the component/non-component seam
// nodeKind.ts established, keeping React Fast Refresh's
// only-export-components rule intact).

// Exposed so the canvas's workflow.run / workflow.runStepped commands
// (shared/commands.ts) trigger exactly the same attrs-check-then-dialog-
// or-immediate-run logic a click on the button already runs, without
// lifting testRunOpen/values state out of this component --
// CompositionCanvas.tsx holds a ref and calls these from its own
// canvasCommandRequest-consuming effect.
export interface RunButtonHandle {
  trigger: () => void
  triggerStepped: () => void
}

// A workflow with declared Attributes opens the same test-input dialog
// the Workflows list's own Run button opens; one with none runs
// immediately. Only rendered once a workflow is saved -- a brand-new,
// not-yet-saved draft has no ID to run against yet.
//
// Run is a SPLIT button (goal 0328): the primary half runs the workflow,
// the menu half holds "Run step by step", which starts the same run in a
// mode that parks before every node. @primer/react ships no SplitButton
// component, so this is the kit's own composition of that pattern --
// ButtonGroup wrapping the primary Button and an ActionMenu-anchored
// caret IconButton. Stepping is a NAMED entry rather than a bare icon:
// it starts a different kind of run, and the reader has to be able to
// tell afterwards which one they asked for.
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

  useImperativeHandle(ref, () => ({
    trigger: () => handleClick(false),
    triggerStepped: () => handleClick(true),
  }), [handleClick])

  if (!workflow) return null

  return (
    <>
      <ButtonGroup>
        <Button
          variant="primary"
          size="small"
          onClick={() => handleClick(false)}
          data-testid="canvas-run"
          title={t('liveRunControls.runButtonTooltip')}
        >
          {t('liveRunControls.run')}
        </Button>
        <ActionMenu>
          <ActionMenu.Anchor>
            <IconButton
              icon={TriangleDownIcon}
              aria-label={t('liveRunControls.runOptionsAriaLabel')}
              variant="primary"
              size="small"
              data-testid="canvas-run-menu"
            />
          </ActionMenu.Anchor>
          <ActionMenu.Overlay>
            <ActionList>
              <ActionList.Item data-testid="canvas-run-stepped" onSelect={() => handleClick(true)}>
                <ActionList.LeadingVisual><BugIcon /></ActionList.LeadingVisual>
                {t('liveRunControls.runStepByStep')}
                <ActionList.Description variant="block">{t('liveRunControls.runStepByStepTooltip')}</ActionList.Description>
              </ActionList.Item>
            </ActionList>
          </ActionMenu.Overlay>
        </ActionMenu>
      </ButtonGroup>
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
