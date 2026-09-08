package executionsvc

import (
	"github.com/alicoding/mill/internal/adapters/execution"
	"github.com/alicoding/mill/internal/domain/composition"
)

// This file owns the webhook ingress's own responder plumbing (goal
// 0373): a run the ingress started with at least one respond-webhook
// node in its graph carries a live, in-memory-only
// composition.WebhookResponder, keyed by runID in
// ExecutionService.responders -- never runInput (a DBOS-checkpointed
// value), since a channel can't be serialized and a DBOS-recovered run
// replay (goal 0329's version gate) must find no entry and run with
// Responder nil rather than fail.

// storeResponder records responder for runID BEFORE the run starts
// (never after), so runWorkflow's own lookup -- which can fire the
// instant DBOS dispatches it -- never races an empty map. A nil
// responder (every caller but the webhook ingress) is a no-op.
func (e *ExecutionService) storeResponder(runID string, responder composition.WebhookResponder) {
	if responder != nil {
		e.responders.Store(runID, responder)
	}
}

// loadResponder reads back what storeResponder recorded, if anything.
// The caller owns removing it (via e.responders.Delete) once the run
// this responder belongs to has actually started running, so a park
// that returns before runWorkflow finishes doesn't drop it early.
func (e *ExecutionService) loadResponder(runID string) (composition.WebhookResponder, bool) {
	v, ok := e.responders.Load(runID)
	if !ok {
		return nil, false
	}
	responder, ok := v.(composition.WebhookResponder)
	return responder, ok
}

// StillRunning reports whether this run has not yet reached a terminal
// state -- true for a genuine in-flight run AND for the narrow window
// right after a may-park run's early return (docs/adr/0022) where
// Pending itself can still read nil: pendingApprovalFor's own
// zero-timeout event poll can race a park that hasn't landed in the
// database yet. A caller deciding "will this run EVER still answer"
// must treat StillRunning as the authority, never infer "done" from a
// nil Pending alone.
func (s RunSummary) StillRunning() bool {
	switch s.Status {
	case string(execution.WorkflowStatusPending), string(execution.WorkflowStatusEnqueued):
		return true
	}
	return s.Pending != nil
}
