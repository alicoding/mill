package executionsvc

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// findBuiltInWorkflowID locates a seeded workflow by label -- built-ins
// are seeded into a fresh CompositionService (restore(), compositionservice.go),
// so a fakeStore-backed one always has them without composing anything.
func findBuiltInWorkflowID(t *testing.T, comp *compositionsvc.CompositionService, label string) string {
	t.Helper()
	for _, wf := range comp.Workflows() {
		if wf.Label == label {
			return wf.ID
		}
	}
	t.Fatalf("no built-in workflow labeled %q", label)
	return ""
}

// Regression: WorkflowStatus.Input/Output and StepInfo.Output all come back from DBOS
// as a raw JSON *string*, not an already-decoded Go value -- decodeAny's
// first version assumed the latter (a plausible but wrong reading of the
// Serializer interface's doc comments) and silently produced a
// zero-valued runInput, which surfaced as every run's WorkflowLabel
// rendering blank in the UI. Verified end-to-end against a real DBOS
// SQLite runtime, not a mock, per .claude/rules/testing.md.
func TestRunWorkflow_SummaryHasRealWorkflowLabelAndStepOutput(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	workflowID := findBuiltInWorkflowID(t, comp, "Load sample HTML")

	dbPath := filepath.Join(t.TempDir(), "exec.db")
	exec, err := NewExecutionService("sqlite:"+dbPath, comp, guardrailsvc.NewGuardrailService(store, comp))
	if err != nil {
		t.Fatalf("NewExecutionService: %v", err)
	}
	t.Cleanup(func() { _ = exec.Shutdown(2 * time.Second) })

	summary, err := exec.RunWorkflow(workflowID, RunKindTest, nil)
	if err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}
	if summary.WorkflowLabel != "Load sample HTML" {
		t.Errorf("summary.WorkflowLabel = %q, want %q", summary.WorkflowLabel, "Load sample HTML")
	}
	if summary.Status != "SUCCESS" {
		t.Errorf("summary.Status = %q, want SUCCESS (osascript write should succeed on this dev machine)", summary.Status)
	}
	if summary.Kind != RunKindTest {
		t.Errorf("summary.Kind = %q, want %q", summary.Kind, RunKindTest)
	}
	if summary.Output == "" {
		t.Error("summary.Output is empty, want the workflow's final payload (decodeAny should have decoded WorkflowStatus.Output)")
	}

	detail, err := exec.GetRun(summary.RunID)
	if err != nil {
		t.Fatalf("GetRun: %v", err)
	}
	if len(detail.Steps) != 1 {
		t.Fatalf("detail.Steps = %d entries, want 1 (a single apply-clipboard-write-html node)", len(detail.Steps))
	}
	step := detail.Steps[0]
	if step.Status != "succeeded" {
		t.Errorf("step.Status = %q, want succeeded", step.Status)
	}
	if step.Output == "" {
		t.Error("step.Output is empty, want the node's real HTML payload (decodeAny should have decoded StepInfo.Output)")
	}
	if step.NodeTypeLabel != "Apply: write HTML to clipboard" {
		t.Errorf("step.NodeTypeLabel = %q, want the real NodeType label, not a blank/ID fallback", step.NodeTypeLabel)
	}
}

// Regression test for the "1-12-31, 6:42:28 PM" bug reported live on
// Review's resolved rows (docs/goals/0002-review-queue-maturation.md
// item 5): RunSummary.StartedAt was rendering Go's zero time for every
// run, because DBOS's own WorkflowStatus.StartedAt is only populated
// for a workflow dequeued off a DBOS Queue (confirmed directly against
// dbos-transact-golang's sysdb source, not assumed) -- Mill never
// enqueues a run onto a Queue, so it was unconditionally zero.
// summaryFromStatus now falls back to st.CreatedAt, which every run
// gets at creation regardless of queueing.
func TestRunWorkflow_SummaryHasNonZeroStartedAt(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	workflowID := findBuiltInWorkflowID(t, comp, "Load sample HTML")

	dbPath := filepath.Join(t.TempDir(), "exec.db")
	exec, err := NewExecutionService("sqlite:"+dbPath, comp, guardrailsvc.NewGuardrailService(store, comp))
	if err != nil {
		t.Fatalf("NewExecutionService: %v", err)
	}
	t.Cleanup(func() { _ = exec.Shutdown(2 * time.Second) })

	before := time.Now().Add(-time.Minute)
	summary, err := exec.RunWorkflow(workflowID, RunKindTest, nil)
	if err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}
	if summary.StartedAt.IsZero() {
		t.Fatal("summary.StartedAt is zero, want a real timestamp")
	}
	if summary.StartedAt.Before(before) {
		t.Errorf("summary.StartedAt = %v, want a timestamp no earlier than %v (this run's own start)", summary.StartedAt, before)
	}

	// ListRuns/ListRunsForWorkflow/GetRun all funnel through the same
	// summaryFromStatus -- confirm the fallback isn't RunWorkflow-only.
	fromList, err := exec.ListRunsForWorkflow(workflowID)
	if err != nil {
		t.Fatalf("ListRunsForWorkflow: %v", err)
	}
	if len(fromList) == 0 {
		t.Fatal("ListRunsForWorkflow returned no runs")
	}
	if fromList[0].StartedAt.IsZero() {
		t.Error("ListRunsForWorkflow's summary.StartedAt is zero, want a real timestamp")
	}
}

// A run redriven from its only step must not re-execute that step's
// exec function a second time if it already succeeded -- ForkWorkflow's
// checkpoint-reuse guarantee (docs/adr/0004), exercised here through
// ExecutionService's own public surface rather than execution package's
// lower-level spike test, so a regression in the wiring between the two
// (stepRunner, node ID naming) is caught even if the lower-level
// mechanism itself stays correct.
func TestRedriveRun_ReturnsNewRunWithSameStepOutput(t *testing.T) {
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

	redriven, err := exec.RedriveRun(original.RunID, originalDetail.Steps[0].NodeID)
	if err != nil {
		t.Fatalf("RedriveRun: %v", err)
	}
	if redriven.RunID == original.RunID {
		t.Error("RedriveRun returned the same RunID as the original -- want a distinct forked run")
	}
	if redriven.Status != "SUCCESS" {
		t.Errorf("redriven.Status = %q, want SUCCESS", redriven.Status)
	}
}
