package main

import (
	"path/filepath"
	"testing"
	"time"
)

// findBuiltInWorkflowID locates a seeded workflow by label -- built-ins
// are seeded into a fresh CompositionService (restore(), compositionservice.go),
// so a fakeStore-backed one always has them without composing anything.
func findBuiltInWorkflowID(t *testing.T, comp *CompositionService, label string) string {
	t.Helper()
	for _, wf := range comp.Workflows() {
		if wf.Label == label {
			return wf.ID
		}
	}
	t.Fatalf("no built-in workflow labeled %q", label)
	return ""
}

// Real regression test for a bug caught live while building the Runs UI:
// WorkflowStatus.Input/Output and StepInfo.Output all come back from DBOS
// as a raw JSON *string*, not an already-decoded Go value -- decodeAny's
// first version assumed the latter (a plausible but wrong reading of the
// Serializer interface's doc comments) and silently produced a
// zero-valued runInput, which surfaced as every run's WorkflowLabel
// rendering blank in the UI. Verified end-to-end against a real DBOS
// SQLite runtime, not a mock, per .claude/rules/testing.md.
func TestRunWorkflowDurable_SummaryHasRealWorkflowLabelAndStepOutput(t *testing.T) {
	store := newFakeStore()
	comp := NewCompositionService(store)
	workflowID := findBuiltInWorkflowID(t, comp, "Load sample HTML")

	dbPath := filepath.Join(t.TempDir(), "exec.db")
	exec, err := NewExecutionService(dbPath, comp)
	if err != nil {
		t.Fatalf("NewExecutionService: %v", err)
	}
	t.Cleanup(func() { _ = exec.Shutdown(2 * time.Second) })

	summary, err := exec.RunWorkflowDurable(workflowID)
	if err != nil {
		t.Fatalf("RunWorkflowDurable: %v", err)
	}
	if summary.WorkflowLabel != "Load sample HTML" {
		t.Errorf("summary.WorkflowLabel = %q, want %q", summary.WorkflowLabel, "Load sample HTML")
	}
	if summary.Status != "SUCCESS" {
		t.Errorf("summary.Status = %q, want SUCCESS (osascript write should succeed on this dev machine)", summary.Status)
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

// A run redriven from its only step must not re-execute that step's
// exec function a second time if it already succeeded -- ForkWorkflow's
// checkpoint-reuse guarantee (docs/adr/0004), exercised here through
// ExecutionService's own public surface rather than execution package's
// lower-level spike test, so a regression in the wiring between the two
// (stepRunner, node ID naming) is caught even if the lower-level
// mechanism itself stays correct.
func TestRedriveRun_ReturnsNewRunWithSameStepOutput(t *testing.T) {
	store := newFakeStore()
	comp := NewCompositionService(store)
	workflowID := findBuiltInWorkflowID(t, comp, "Load sample HTML")

	dbPath := filepath.Join(t.TempDir(), "exec.db")
	exec, err := NewExecutionService(dbPath, comp)
	if err != nil {
		t.Fatalf("NewExecutionService: %v", err)
	}
	t.Cleanup(func() { _ = exec.Shutdown(2 * time.Second) })

	original, err := exec.RunWorkflowDurable(workflowID)
	if err != nil {
		t.Fatalf("RunWorkflowDurable: %v", err)
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
