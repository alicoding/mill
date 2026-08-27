import { useCodingLoopRun } from './useCodingLoopRun'
import { CodingLoopConfirmState } from './CodingLoopConfirmState'
import { CodingLoopRunningState } from './CodingLoopRunningState'
import { CodingLoopResultState } from './CodingLoopResultState'

interface Props {
  clipboardText: string
  onClose: () => void
}

// CodingLoopSurface (docs/goals/0240 S1): the one three-state surface --
// Confirm/Running/Result -- composed from per-state components so a
// state can be reworked without rewiring the loop (the goal's own "GO"
// build directive). No outer chrome of its own (no Dialog, no panel
// Stack wrapper): app/CodingLoopDialog.tsx wraps it in a Primer Dialog
// for the main window, app/QuickPanel.tsx swaps it straight into the
// panel's own body -- same split QuickPanelClipboardApply.tsx already
// establishes between panel-owned chrome and reusable content.
export function CodingLoopSurface({ clipboardText, onClose }: Props) {
  const {
    phase, preview, previewError, detail, stepProgress, startError, copyState, lastProgressAt,
    run, cancel, copyResult,
  } = useCodingLoopRun(clipboardText)

  if (phase === 'confirm') {
    return (
      <CodingLoopConfirmState
        preview={preview}
        previewError={previewError}
        startError={startError}
        onRun={run}
        onCancel={onClose}
      />
    )
  }

  if (phase === 'running' && preview) {
    return (
      <CodingLoopRunningState
        preview={preview}
        stepProgress={stepProgress}
        lastProgressAt={lastProgressAt}
        startError={startError}
        onCancel={cancel}
      />
    )
  }

  return <CodingLoopResultState detail={detail} copyState={copyState} onCopy={copyResult} />
}
