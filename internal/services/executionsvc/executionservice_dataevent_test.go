package executionsvc

import (
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/adapters/execution"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
	"github.com/google/uuid"
)

// captureRunEmits installs dataevent.TestHook, mutex-guarded (the
// completion emit fires on the DBOS workflow goroutine while a test's
// own calls happen on the test goroutine -- an unsynchronized slice
// append here would trip -race exactly like
// TestRunWorkflow_EmitsRunDataEventOnStartAndCompletion's own capture),
// and restores it via t.Cleanup. Returns a snapshot func.
func captureRunEmits(t *testing.T) func() []string {
	t.Helper()
	var mu sync.Mutex
	var ids []string
	dataevent.TestHook = func(entity, id string) {
		if entity == "run" {
			mu.Lock()
			ids = append(ids, id)
			mu.Unlock()
		}
	}
	t.Cleanup(func() { dataevent.TestHook = nil })
	return func() []string {
		mu.Lock()
		defer mu.Unlock()
		return append([]string(nil), ids...)
	}
}

// Regression: a run started from the UI (canvas Run) or a trigger never
// emitted mill-data-changed{entity:"run"} -- only the MCP debug tools
// did -- so an already-open Runs panel (which stays mounted across
// section-tab switches and refreshes only on that event) showed a
// stale, possibly empty list until a full app reload. Pins both
// emission points: run start (runWorkflowStart) and run completion
// (runWorkflow, the one function every run finishes through).
func TestRunWorkflow_EmitsRunDataEventOnStartAndCompletion(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	workflowID := findBuiltInWorkflowID(t, comp, "Load sample HTML")

	dbPath := filepath.Join(t.TempDir(), "exec.db")
	exec, err := NewExecutionService("sqlite:"+dbPath, comp, guardrailsvc.NewGuardrailService(store, comp))
	if err != nil {
		t.Fatalf("NewExecutionService: %v", err)
	}
	t.Cleanup(func() { _ = exec.Shutdown(2 * time.Second) })

	// The start emit fires on the caller's goroutine and the completion
	// emit inside the DBOS workflow goroutine -- the capture must be
	// mutex-guarded or the race detector (rightly) fails this test.
	var mu sync.Mutex
	var runEmits []string
	dataevent.TestHook = func(entity, id string) {
		if entity == "run" {
			mu.Lock()
			runEmits = append(runEmits, id)
			mu.Unlock()
		}
	}
	t.Cleanup(func() { dataevent.TestHook = nil })

	summary, err := exec.RunWorkflow(workflowID, RunKindTest, nil)
	if err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}

	mu.Lock()
	got := append([]string(nil), runEmits...)
	mu.Unlock()
	if len(got) < 2 {
		t.Fatalf("got %d mill-data-changed{entity:%q} emits, want at least 2 (start + completion)", len(got), "run")
	}
	for i, id := range got {
		if id != summary.RunID {
			t.Errorf("emit %d carries id %q, want the run's own id %q", i, id, summary.RunID)
		}
	}
}

// Regression: a parked run's approval/denial changed its user-visible
// state (pending -> resolved) immediately, but no mill-data-changed
// fired until the resumed run's graph finished executing -- an open
// Runs panel showed the run as still "awaiting approval" for however
// long the remaining steps took. Pins ResolveApproval's own emit.
func TestResolveApproval_EmitsRunDataEvent(t *testing.T) {
	_, exec, wfID := newGuardedHarness(t)

	summary, err := exec.RunWorkflow(wfID, RunKindTest, nil)
	if err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}
	waitFor(t, "pending approval", 10*time.Second, func() (struct{}, bool) {
		s, err := exec.summaryFor(summary.RunID)
		return struct{}{}, err == nil && s.Pending != nil
	})

	snapshot := captureRunEmits(t)
	if err := exec.ResolveApproval(summary.RunID, "n1", true, nil, false); err != nil {
		t.Fatalf("ResolveApproval: %v", err)
	}

	got := snapshot()
	if len(got) == 0 {
		t.Fatal("ResolveApproval emitted no mill-data-changed{entity:\"run\"}")
	}
	if got[0] != summary.RunID {
		t.Errorf("first emit carries id %q, want the resolved run's own id %q", got[0], summary.RunID)
	}
}

// Regression: a run cancelled while still ENQUEUED (never dequeued by
// DBOS, so runWorkflow's own completion emit never fires for it) left
// an open Runs panel showing it as enqueued forever. Reuses
// executionservice_enqueued_test.go's WithWorkerConcurrency(0) recipe
// to construct a reproducible, indefinitely-stuck ENQUEUED run.
func TestCancelRun_EmitsRunDataEvent_StillEnqueued(t *testing.T) {
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

	queue, err := execution.RegisterQueue(exec.ctx, "test-stuck-enqueued-dataevent", execution.WithWorkerConcurrency(0))
	if err != nil {
		t.Fatalf("RegisterQueue: %v", err)
	}

	runID := uuid.NewString()
	if _, err := execution.RunWorkflow(exec.ctx, exec.runWorkflow, runInput{
		WorkflowID: wf.ID, Nodes: nodes, Edges: edges, Attributes: attrs,
		Kind: RunKindTest, Version: version,
	}, execution.WithWorkflowID(runID), execution.WithQueue(queue)); err != nil {
		t.Fatalf("RunWorkflow (enqueue): %v", err)
	}

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

	snapshot := captureRunEmits(t)
	if err := exec.CancelRun(runID); err != nil {
		t.Fatalf("CancelRun on a still-ENQUEUED run: %v", err)
	}

	got := snapshot()
	if len(got) == 0 {
		t.Fatal("CancelRun emitted no mill-data-changed{entity:\"run\"} for a still-ENQUEUED run")
	}
	if got[0] != runID {
		t.Errorf("first emit carries id %q, want the cancelled run's own id %q", got[0], runID)
	}
}

// Regression: RedriveRun forks a run outside runWorkflowStart (via
// execution.ForkWorkflow directly), so the start emit runWorkflowStart
// fires for a normal Run never covered the forked run -- an open Runs
// panel wouldn't show the redriven run until it happened to complete.
func TestRedriveRun_EmitsRunDataEventForForkedID(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	workflowID := findBuiltInWorkflowID(t, comp, "Load sample HTML")

	dbPath := filepath.Join(t.TempDir(), "exec.db")
	exec, err := NewExecutionService("sqlite:"+dbPath, comp, guardrailsvc.NewGuardrailService(store, comp))
	if err != nil {
		t.Fatalf("NewExecutionService: %v", err)
	}
	t.Cleanup(func() { _ = exec.Shutdown(2 * time.Second) })

	original, err := exec.RunWorkflow(workflowID, RunKindTest, nil)
	if err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}
	originalDetail, err := exec.GetRun(original.RunID)
	if err != nil {
		t.Fatalf("GetRun (original): %v", err)
	}
	if len(originalDetail.Steps) != 1 {
		t.Fatalf("originalDetail.Steps = %d entries, want 1", len(originalDetail.Steps))
	}

	snapshot := captureRunEmits(t)
	redriven, err := exec.RedriveRun(original.RunID, originalDetail.Steps[0].NodeID)
	if err != nil {
		t.Fatalf("RedriveRun: %v", err)
	}

	got := snapshot()
	if len(got) == 0 {
		t.Fatal("RedriveRun emitted no mill-data-changed{entity:\"run\"}")
	}
	if got[0] != redriven.RunID {
		t.Errorf("first emit carries id %q, want the forked run's own id %q (start emit precedes completion)", got[0], redriven.RunID)
	}
}
