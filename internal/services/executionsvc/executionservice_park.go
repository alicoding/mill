package executionsvc

import (
	"fmt"
	"time"

	"github.com/alicoding/mill/internal/adapters/execution"
)

// The one park primitive every waiting run goes through: an approval
// ask, a human-review checkpoint, a debug pause and a vault wait all
// advertise a PendingApproval under the same event key, register the
// same live listener, and block on the same durable Recv until
// ResolveApproval Sends a decision or the timeout elapses. What differs
// per caller is only the pending record's own fields and what the
// caller does with the decision -- never a second pending mechanism.

// park publishes pending as this run's live park and blocks on the
// durable Recv until a decision arrives or timeout elapses. A zero
// decision (NodeID == "") means the timeout fired with nobody
// answering. Every path out clears the live-park registry entry.
//
// Ordering invariant: the registry entry MUST exist before the pending
// event is published. That event is the only signal any caller has
// that this run has parked, so a resolve arriving the instant it
// appears would otherwise find no listener and be refused as
// "run-recovering" (resolveUnlistened). Recv tolerates a Send that
// lands before it -- StartRecvListener reports an already pending
// notification -- so registering early costs nothing.
func (e *ExecutionService) park(ctx execution.Context, pending PendingApproval, timeout time.Duration) (approvalDecision, error) {
	runID, _ := ctx.GetWorkflowID()
	e.parkedRuns.Store(runID, pending.NodeID)
	defer e.parkedRuns.Delete(runID)

	if err := execution.SetEvent(ctx, guardrailPendingEventKey, pending); err != nil {
		return approvalDecision{}, fmt.Errorf("publish pending park: %w", err)
	}
	emitGuardrailPendingChanged(runID, pending.NodeID, false)
	// docs/adr/0035: the decision-parked half of trigger-system-event --
	// only the park is a system event (not the resolve), matching the
	// forward-pending-approvals use case: something to act on NOW, not a
	// record of how it was later resolved. A vault wait is a state of
	// the run, not a decision anyone is asked for, so it never fires it.
	if pending.Reason == "" {
		e.emitSystemEvent(SystemEventDecisionParked, runID, pending.NodeID)
	}

	return execution.Recv[approvalDecision](ctx, guardrailApprovalTopic, timeout)
}

// resolvePark records the park's outcome on the same event the park
// wrote (the Review queue's recently-resolved section reads it back)
// and signals every open surface.
func (e *ExecutionService) resolvePark(ctx execution.Context, pending PendingApproval, decision string) {
	runID, _ := ctx.GetWorkflowID()
	pending.Resolved = true
	pending.Decision = decision
	_ = execution.SetEvent(ctx, guardrailPendingEventKey, pending)
	emitGuardrailPendingChanged(runID, pending.NodeID, true)
}
