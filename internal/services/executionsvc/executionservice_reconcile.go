package executionsvc

import (
	"fmt"
	"log/slog"

	"github.com/alicoding/mill/internal/adapters/execution"
)

// WorkflowCodeVersion is the durable runtime's application version
// (execution.New's appVersion). Bump it ONLY when runWorkflow's step
// sequence changes such that a run parked under the old code could not
// safely replay its recorded checkpoints under the new code. A bump
// interrupts every run parked under the old value: those runs are
// cancelled at the next launch (ReconcileInterrupted) instead of
// resuming, because DBOS's launch recovery and queue dequeue both match
// on an exact application_version. Leaving this constant alone across a
// release is what lets an in-flight approval survive an app update.
const WorkflowCodeVersion = "1"

// ResolutionInterrupted is RunSummary.Resolution for a run that was
// parked on an approval when Mill relaunched under a different
// WorkflowCodeVersion. The other legal values are written by
// parkForApproval as PendingApproval.Decision: "approved", "denied",
// "timed out", and "" for a run that never parked.
const ResolutionInterrupted = "interrupted"

// ReconcileInterrupted settles every run stranded by a version change,
// once, right after Launch. DBOS re-enqueues a PENDING run on recovery
// only when its application_version equals the running context's, so a
// run parked for approval before an update stays PENDING forever with
// nothing executing it -- the canvas would keep offering Resume and
// Stop on a run that can never answer. Cancelling makes the run's own
// row honest; summaryFromStatus reads that back as Interrupted.
// Same-version runs are left alone: those are the engine's own
// recovery's job.
//
//wails:ignore
func (e *ExecutionService) ReconcileInterrupted() error {
	statuses, err := execution.ListWorkflows(e.ctx,
		execution.WithFilterStatus(execution.WorkflowStatusPending, execution.WorkflowStatusEnqueued))
	if err != nil {
		return fmt.Errorf("reconcile interrupted: list runs: %w", err)
	}
	count := 0
	for _, st := range statuses {
		if st.ApplicationVersion == e.appVersion {
			continue
		}
		if err := execution.CancelWorkflow(e.ctx, st.ID); err != nil {
			slog.Error("execution: cancel interrupted run", "run", st.ID, "error", err)
			continue
		}
		count++
	}
	if count > 0 {
		slog.Info("execution: interrupted runs reconciled", "count", count, "version", e.appVersion)
	}
	return nil
}

// interruptedRun reports whether a terminal run's row is one
// ReconcileInterrupted settled: cancelled, written by another
// workflow-code version, and still carrying an unresolved park. A run a
// person stopped on the current version fails the version test and
// keeps reading exactly as it does today.
func (e *ExecutionService) interruptedRun(st execution.WorkflowStatus) bool {
	if st.Status != execution.WorkflowStatusCancelled || st.ApplicationVersion == e.appVersion {
		return false
	}
	return e.pendingApprovalFor(st.ID) != nil
}
