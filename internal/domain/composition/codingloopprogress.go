package composition

// ShellStepProgress is one live update from a running execute-shell-command
// node -- DBOS only checkpoints a step once it completes (no native
// "currently executing" status, confirmed against liveRunState.ts's own
// doc comment), so the sub-command-level progress this node's exec
// function produces has nowhere to land in the checkpointed step
// record until the whole node finishes. This event is that missing
// half: streamed live via the injected emitter below, while the node's
// own DBOS step still records only the FINAL combined output at
// completion (docs/goals/0240 S1's own "state which" directive).
type ShellStepProgress struct {
	NodeID     string `json:"nodeID"`
	StepIndex  int    `json:"stepIndex"`
	TotalSteps int    `json:"totalSteps"`
	Command    string `json:"command"`
	// Status is "running" | "done" | "failed" | "skipped" -- skipped
	// means a JoinAnd (&&) step was never attempted because the step
	// before it failed.
	Status string `json:"status"`
	// OutputTail is the step's own most recent output, already capped
	// to the backend's own tail-length constant (shellStepProgressTailLines,
	// codingloopconfig.go) by the emitter's caller.
	OutputTail string `json:"outputTail,omitempty"`
	ExitCode   int    `json:"exitCode,omitempty"`
}

// emitShellStepProgressFn defaults to a no-op so a direct
// composition.ExecuteWorkflow call (this package's own unit tests, which
// never wire this seam) still runs the node -- it just has nowhere to
// stream progress, same "no durable caller, no live channel" shape as
// registerRunningProcessFn's own default.
var emitShellStepProgressFn = func(_ any, _ ShellStepProgress) {}

// SetShellStepProgressEmitter wires the function executeshellcommand.go
// calls after every sub-command's status change -- called once from
// executionsvc's ExecutionService constructor, which knows how to turn
// runCtx (an execution.Context in production) into the run ID the
// frontend needs to filter events by, since composition itself never
// imports the DBOS adapter (domain purity, .claude/rules/backend.md).
func SetShellStepProgressEmitter(fn func(runCtx any, p ShellStepProgress)) {
	emitShellStepProgressFn = fn
}
