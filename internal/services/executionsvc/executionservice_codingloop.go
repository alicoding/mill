package executionsvc

import (
	"github.com/alicoding/mill/internal/adapters/execution"
	"github.com/alicoding/mill/internal/adapters/windowing"
	"github.com/alicoding/mill/internal/domain/composition"
)

// The coding loop's live-progress bridge (docs/goals/0240 S1): DBOS
// only checkpoints a workflow step on completion (composition.
// ShellStepProgress's own doc comment), so process-shell-command's
// per-sub-command progress has nowhere to land in the checkpointed
// step record until the whole node finishes. This file is the wiring
// half of that gap -- composition.SetShellStepProgressEmitter installs
// emitShellStepProgress here, which turns the domain-level runCtx (an
// `any`, since composition never imports the DBOS adapter) into the
// real run ID the frontend filters events by, mirroring registerProcess's
// identical runCtx type-assertion in executionservice_cancel.go.

// CodingLoopStepProgressEvent is the Wails event payload -- composition.
// ShellStepProgress plus the RunID the frontend needs to know which
// live surface it belongs to (a Quick Panel door or the main window may
// have several coding-loop runs started across a session; only the
// currently-displayed run's ID matters to either).
type CodingLoopStepProgressEvent struct {
	RunID string `json:"runID"`
	composition.ShellStepProgress
}

// codingLoopStepProgressEventName is the Wails event name the frontend
// subscribes to (shared/codingLoopConstants.ts's CODING_LOOP_PROGRESS_EVENT
// is its TypeScript-side counterpart -- named once per language, same
// split as codingloopconfig.go's own header comment explains for the
// numeric constants).
const codingLoopStepProgressEventName = "codingloop-step-progress"

// emitShellStepProgress implements composition.SetShellStepProgressEmitter.
// runCtx is only ever a real execution.Context in production (ADR-0008's
// single execution path); any other value (a direct
// composition.ExecuteWorkflow call, e.g. this package's own unit tests
// that don't wire this seam) emits nothing -- there's no run identity
// to attach the event to anyway, same "no durable caller, no live
// channel" shape registerProcess already establishes.
func (e *ExecutionService) emitShellStepProgress(runCtx any, p composition.ShellStepProgress) {
	ctx, ok := runCtx.(execution.Context)
	if !ok || ctx == nil {
		return
	}
	runID, err := ctx.GetWorkflowID()
	if err != nil || runID == "" {
		return
	}
	windowing.Emit(codingLoopStepProgressEventName, CodingLoopStepProgressEvent{RunID: runID, ShellStepProgress: p})
}
