package executionsvc

import (
	"log/slog"
	"time"

	"github.com/alicoding/mill/internal/adapters/execution"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
)

// The durable runtime's lifecycle: construct-and-launch, the injected
// seams composition needs wired at that moment, and shutdown. Split
// from executionservice.go (which keeps the run/step shapes and the
// workflow body) at the 500-line limit, along the same "one file owns
// one concern end to end" seam executionservice_cancel.go established.

// NewExecutionService builds and launches the durable-execution runtime
// backed by databaseURL (a DBOS-native DSN -- see execution.New's own
// doc comment for the sqlite-by-default, Postgres-by-config reasoning).
// Registration happens inside execution.New, before Launch, per that
// function's own doc comment.
func NewExecutionService(databaseURL string, comp *compositionsvc.CompositionService, guard *guardrailsvc.GuardrailService) (*ExecutionService, error) {
	return NewExecutionServiceWithVersion(databaseURL, WorkflowCodeVersion, comp, guard)
}

// NewExecutionServiceWithVersion is NewExecutionService with the
// durable runtime's application version supplied explicitly -- the seam
// a test needs to relaunch the SAME database under a different
// workflow-code version (see WorkflowCodeVersion). Production always
// passes WorkflowCodeVersion.
func NewExecutionServiceWithVersion(databaseURL, appVersion string, comp *compositionsvc.CompositionService, guard *guardrailsvc.GuardrailService) (*ExecutionService, error) {
	e := &ExecutionService{comp: comp, guard: guard, cancelState: newCancelState(), appVersion: appVersion}
	ctx, err := execution.New("mill", appVersion, databaseURL, func(ctx execution.Context) {
		execution.RegisterWorkflow(ctx, e.runWorkflow, execution.WithWorkflowName(millRunWorkflowName))
	})
	if err != nil {
		return nil, err
	}
	e.ctx = ctx
	// The guardrail gate (docs/adr/0022) hooks composition's walk here
	// -- the one place holding both the rules and the durable context.
	composition.SetGuardrailGate(e.guardrailGate)
	composition.SetApprovalWaiter(e.approvalWaiter)
	// docs/adr/0026: a running code-execution step publishes its live
	// procexec.Handle here so CancelRun can reach it from outside the
	// run (executionservice_cancel.go).
	composition.SetProcessRegistrar(e.registerProcess)
	// docs/goals/0240 S1: a running process-shell-command sub-command
	// streams its live progress here (executionservice_codingloop.go),
	// since DBOS itself only checkpoints the step on completion.
	composition.SetShellStepProgressEmitter(e.emitShellStepProgress)
	// goal 0052 slice 3, ADR-0036: a process-run-receipt node reads this
	// run's own recorded evidence-so-far through this seam
	// (executionservice_receipt.go).
	composition.SetRunEvidenceLookup(e.runEvidenceLookup)
	composition.SetCurrentRunIDLookup(e.CurrentRunID) // goal 0066
	// Runs stranded by an earlier build's application version are
	// settled here, once, immediately after Launch -- before any surface
	// can offer Resume/Approve on a run nothing will ever answer
	// (goal 0329).
	if err := e.ReconcileInterrupted(); err != nil {
		slog.Error("execution: reconcile interrupted runs", "error", err)
	}
	return e, nil
}

// Shutdown stops the durable-execution runtime -- called from main.go on
// application shutdown so in-flight step checkpoints flush cleanly.
//
//wails:ignore
func (e *ExecutionService) Shutdown(timeout time.Duration) error {
	return execution.Shutdown(e.ctx, timeout)
}
