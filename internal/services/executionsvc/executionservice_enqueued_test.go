package executionsvc

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/adapters/execution"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
	"github.com/google/uuid"
)

// docs/goals/0026 item 8: a real, stuck-forever ENQUEUED run was found
// in production data (a zombie run from a morning error) -- reading as
// live when it was never going to progress. This is Mill's own
// regression coverage for the two things that ask depends on: (1) a
// RunSummary for an ENQUEUED run carries real presentation fields (a
// non-zero StartedAt in particular -- the frontend's age-tier
// presentation, docs/goals/0026 items 2/8, has nothing to render an age
// from otherwise) and (2) CancelRun actually cancels a still-ENQUEUED
// run, not just a running/pending one.
//
// Mill's own production path never enqueues a run onto a DBOS Queue
// (executionservice_test.go's TestRunWorkflow_SummaryHasNonZeroStartedAt
// already documents this directly), so there's no way to reach ENQUEUED
// through RunWorkflow/RunWorkflowWithPayload as written. A queue
// registered with WithWorkerConcurrency(0) never dequeues anything
// submitted to it -- the real, SDK-documented mechanism this test uses
// to construct a reproducible, indefinitely-stuck ENQUEUED run, calling
// through to the exact same registered workflow function
// (exec.runWorkflow) production code uses, via execution.RunWorkflow +
// execution.WithQueue directly (white-box, same package).
func TestListRuns_EnqueuedRun_PresentationFieldsAndCancelPath(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	workflowID := findBuiltInWorkflowID(t, comp, "Load sample HTML")

	dbPath := filepath.Join(t.TempDir(), "enqueued.db")
	exec, err := NewExecutionService("sqlite:"+dbPath, comp, guardrailsvc.NewGuardrailService(store, comp))
	if err != nil {
		t.Fatalf("NewExecutionService: %v", err)
	}
	t.Cleanup(func() { _ = exec.Shutdown(2 * time.Second) })

	wf, ok := exec.findWorkflow(workflowID)
	if !ok {
		t.Fatalf("findWorkflow(%q): not found", workflowID)
	}
	nodes, edges, attrs, version, err := composition.ResolveRunnable(wf, true, 0)
	if err != nil {
		t.Fatalf("ResolveRunnable: %v", err)
	}

	queue, err := execution.RegisterQueue(exec.ctx, "test-stuck-enqueued", execution.WithWorkerConcurrency(0))
	if err != nil {
		t.Fatalf("RegisterQueue: %v", err)
	}

	runID := uuid.NewString()
	before := time.Now().Add(-time.Minute)
	if _, err := execution.RunWorkflow(exec.ctx, exec.runWorkflow, runInput{
		WorkflowID: wf.ID, Nodes: nodes, Edges: edges, Attributes: attrs,
		Kind: RunKindTest, Version: version,
	}, execution.WithWorkflowID(runID), execution.WithQueue(queue)); err != nil {
		t.Fatalf("RunWorkflow (enqueue): %v", err)
	}

	// Poll briefly: the row lands via an async DB write relative to
	// RunWorkflow's own return, but with WorkerConcurrency(0) it will
	// NEVER be dequeued, so once observed as ENQUEUED it stays that way
	// for the rest of this test -- no race to worry about after this
	// loop exits.
	var summary RunSummary
	deadline := time.Now().Add(5 * time.Second)
	for {
		summary, err = exec.summaryFor(runID)
		if err == nil && summary.Status == "ENQUEUED" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("run never reached ENQUEUED status (last status %q, err %v)", summary.Status, err)
		}
		time.Sleep(20 * time.Millisecond)
	}

	// Presentation fields (item 8's "run summary presentation fields"):
	// StartedAt must be populated (falls back to CreatedAt for a run
	// DBOS never dequeued -- executionservice_summary.go's own
	// documented fallback) so the frontend's age-tier presentation has
	// something real to compute "expires in Nh" from; a zero StartedAt
	// would silently break it.
	if summary.StartedAt.IsZero() {
		t.Error("ENQUEUED run summary.StartedAt is zero, want the CreatedAt fallback (see executionservice_summary.go)")
	}
	if summary.StartedAt.Before(before) {
		t.Errorf("summary.StartedAt = %v, want no earlier than %v", summary.StartedAt, before)
	}
	if summary.WorkflowLabel != "Load sample HTML" {
		t.Errorf("summary.WorkflowLabel = %q, want the real workflow label even while enqueued", summary.WorkflowLabel)
	}

	// Cancel path: CancelRun must handle a still-ENQUEUED run. DBOS's
	// own CancelWorkflow is documented to cancel "a running or enqueued
	// workflow" -- confirmed here against a real ENQUEUED row, not just
	// trusted from the doc comment.
	if err := exec.CancelRun(runID); err != nil {
		t.Fatalf("CancelRun on a still-ENQUEUED run: %v", err)
	}

	deadline = time.Now().Add(5 * time.Second)
	for {
		summary, err = exec.summaryFor(runID)
		if err == nil && summary.Status == "CANCELLED" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("run never reached CANCELLED status after CancelRun (last status %q)", summary.Status)
		}
		time.Sleep(20 * time.Millisecond)
	}
}
