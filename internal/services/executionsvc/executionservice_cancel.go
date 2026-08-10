package executionsvc

import (
	"strings"
	"sync"

	"github.com/alicoding/mill/internal/adapters/execution"
	"github.com/alicoding/mill/internal/adapters/procexec"
)

// Cancellation (docs/adr/0026's Amendment, goal 0004b): DBOS cannot
// interrupt an executing step (confirmed from its own source -- see
// execution.CancelWorkflow's doc comment), so a real kill needs the
// locally-held, live procexec.Handle for whatever code-execution step
// is currently running. ExecutionService holds a small in-process
// registry (composition.SetProcessRegistrar wires codeexec.go into it)
// keyed by "runID:nodeID" -- CancelRun both kills the real process
// (Handle.Cancel(), SIGTERM-then-SIGKILL) AND marks the DBOS workflow
// CANCELLED (execution.CancelWorkflow), the same "one implementation,
// two effects" shape the ADR names for timeout-vs-user-cancel.
//
// Explicitly NOT built in this pass, named here rather than silently
// missing (ADR-0026's Amendment items 3-4, deferred): the pgid is not
// durably recorded before spawn, so a crash between spawn and the next
// checkpoint leaves an unreachable orphan process group -- no
// startup-time orphan-reaping exists yet. An interrupted (crashed
// mid-step) run is NOT specially parked for a human rerun/mark-failed
// decision -- DBOS's own crash-replay will simply re-execute the step
// from scratch, which for a code-execution step means running the
// command again, not the "at-most-once by default for effectful
// steps" guarantee the ADR states as its own eventual target. Both are
// real, scoped follow-up work, not overlooked.

// registryKey joins a run and node ID into this registry's one map
// key -- a plain string join rather than a struct key purely so
// CancelRun (which only knows runID) can prefix-match every node of
// that run without a second index.
func registryKey(runID, nodeID string) string {
	return runID + ":" + nodeID
}

// registerProcess implements composition.SetProcessRegistrar --
// codeexec.go calls this once per code-execution step start (via its
// own registerRunningProcessFn seam) and calls the returned func once
// the step finishes, success or failure. runCtx is only ever a real
// execution.Context in production (ADR-0008's single execution path);
// any other value (a direct composition.ExecuteWorkflow call, e.g. this
// package's own unit tests that don't wire this seam) registers
// nothing and returns a no-op unregister -- there's no run identity to
// cancel by outside a durable run anyway.
func (e *ExecutionService) registerProcess(runCtx any, nodeID string, h *procexec.Handle) func() {
	ctx, ok := runCtx.(execution.Context)
	if !ok || ctx == nil {
		return func() {}
	}
	runID, err := ctx.GetWorkflowID()
	if err != nil || runID == "" {
		return func() {}
	}
	key := registryKey(runID, nodeID)
	e.cancelMu.Lock()
	e.cancelHandles[key] = h
	e.cancelMu.Unlock()
	return func() {
		e.cancelMu.Lock()
		delete(e.cancelHandles, key)
		e.cancelMu.Unlock()
	}
}

// CancelRun stops an in-flight run (docs/adr/0026): kills every
// currently-registered live process belonging to runID (in practice at
// most one -- composition's graph walk executes nodes serially, no
// concurrent node execution exists yet) via procexec's own real
// process-group SIGTERM-then-SIGKILL escalation, and marks the DBOS
// workflow CANCELLED so ListRuns/GetRun reflect it even for a run with
// no code-execution step currently live (e.g. cancelling a parked
// approval instead of, or in addition to, a running process). Safe to
// call on a run with no registered process at all -- the kill loop is
// simply a no-op, and the DBOS-level cancel still applies.
func (e *ExecutionService) CancelRun(runID string) error {
	e.cancelMu.Lock()
	var handles []*procexec.Handle
	prefix := runID + ":"
	for key, h := range e.cancelHandles {
		if strings.HasPrefix(key, prefix) {
			handles = append(handles, h)
		}
	}
	e.cancelMu.Unlock()

	for _, h := range handles {
		h.Cancel()
	}

	return execution.CancelWorkflow(e.ctx, runID)
}

// cancelState is embedded into ExecutionService (executionservice.go)
// -- kept as its own small type here rather than inlined fields there,
// so this file stays the single place that owns the registry's
// lifecycle end to end.
type cancelState struct {
	cancelMu      sync.Mutex
	cancelHandles map[string]*procexec.Handle
}

func newCancelState() cancelState {
	return cancelState{cancelHandles: make(map[string]*procexec.Handle)}
}
