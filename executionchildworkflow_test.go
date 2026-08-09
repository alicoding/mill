package main

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/adapters/execution"
	"github.com/alicoding/mill/internal/domain/composition"
)

// Real, end-to-end proof of docs/adr/0010's core claim: a child-workflow
// node's dbos.RunWorkflow call, made from inside the parent's own
// running workflow, gets DBOS's native parent/child tracking for free
// -- not asserted from the SDK's docs alone.
func TestRunChildWorkflow_TracksRealParentChildRelationship(t *testing.T) {
	store := newFakeStore()
	comp := NewCompositionService(store)

	childWF, err := comp.CreateWorkflow("E2E child target", "", []composition.Node{
		{ID: "trig", NodeTypeID: "trigger-callable"},
		{ID: "apply", NodeTypeID: "apply-clipboard-write-text"},
	}, []composition.Edge{
		{ID: "e1", Source: "trig", Target: "apply"},
	})
	if err != nil {
		t.Fatalf("CreateWorkflow (child) returned error: %v", err)
	}

	parentWF, err := comp.CreateWorkflow("E2E parent", "", []composition.Node{
		{ID: "trig", NodeTypeID: "trigger-manual"},
		{ID: "call", NodeTypeID: "child-workflow", Config: map[string]string{
			"workflowId": childWF.ID, "inputBindings": "{}",
		}},
	}, []composition.Edge{
		{ID: "e1", Source: "trig", Target: "call"},
	})
	if err != nil {
		t.Fatalf("CreateWorkflow (parent) returned error: %v", err)
	}

	dbPath := filepath.Join(t.TempDir(), "exec.db")
	exec, err := NewExecutionService("sqlite:"+dbPath, comp)
	if err != nil {
		t.Fatalf("NewExecutionService: %v", err)
	}
	t.Cleanup(func() { _ = exec.Shutdown(2 * time.Second) })
	exec.wireChildWorkflowRunner()

	summary, err := exec.RunWorkflow(parentWF.ID, RunKindTest, nil)
	if err != nil {
		t.Fatalf("RunWorkflow (parent): %v", err)
	}
	if summary.Status != "SUCCESS" {
		t.Fatalf("parent run status = %q, want SUCCESS (error: %s)", summary.Status, summary.Error)
	}

	children, err := execution.ListWorkflows(exec.ctx, execution.WithFilterParentWorkflowID(summary.RunID))
	if err != nil {
		t.Fatalf("ListWorkflows(WithFilterParentWorkflowID): %v", err)
	}
	if len(children) != 1 {
		t.Fatalf("found %d children of parent run %s, want exactly 1", len(children), summary.RunID)
	}
	if children[0].Status != "SUCCESS" {
		t.Errorf("child run status = %q, want SUCCESS", children[0].Status)
	}
}

// Real proof of the idempotency-key half: re-invoking a child workflow
// with the same resolved key must not start a second child run.
func TestRunChildWorkflow_IdempotencyKey_PreventsDuplicateChildRuns(t *testing.T) {
	store := newFakeStore()
	comp := NewCompositionService(store)

	childWF, err := comp.CreateWorkflow("E2E idempotent child", "", []composition.Node{
		{ID: "trig", NodeTypeID: "trigger-callable"},
		{ID: "apply", NodeTypeID: "apply-clipboard-write-text"},
	}, []composition.Edge{
		{ID: "e1", Source: "trig", Target: "apply"},
	})
	if err != nil {
		t.Fatalf("CreateWorkflow (child) returned error: %v", err)
	}

	parentWF, err := comp.CreateWorkflow("E2E idempotent parent", "", []composition.Node{
		{ID: "trig", NodeTypeID: "trigger-manual"},
		{ID: "call", NodeTypeID: "child-workflow", Config: map[string]string{
			"workflowId": childWF.ID, "inputBindings": "{}", "idempotencyKey": "fixed-key-123",
		}},
	}, []composition.Edge{
		{ID: "e1", Source: "trig", Target: "call"},
	})
	if err != nil {
		t.Fatalf("CreateWorkflow (parent) returned error: %v", err)
	}

	dbPath := filepath.Join(t.TempDir(), "exec.db")
	exec, err := NewExecutionService("sqlite:"+dbPath, comp)
	if err != nil {
		t.Fatalf("NewExecutionService: %v", err)
	}
	t.Cleanup(func() { _ = exec.Shutdown(2 * time.Second) })
	exec.wireChildWorkflowRunner()

	first, err := exec.RunWorkflow(parentWF.ID, RunKindTest, nil)
	if err != nil || first.Status != "SUCCESS" {
		t.Fatalf("first parent run: status=%q err=%v", first.Status, err)
	}
	second, err := exec.RunWorkflow(parentWF.ID, RunKindTest, nil)
	if err != nil || second.Status != "SUCCESS" {
		t.Fatalf("second parent run: status=%q err=%v", second.Status, err)
	}

	all, err := execution.ListWorkflows(exec.ctx, execution.WithFilterWorkflowIDs("fixed-key-123"))
	if err != nil {
		t.Fatalf("ListWorkflows: %v", err)
	}
	if len(all) != 1 {
		t.Fatalf("found %d runs with workflow ID %q across two parent invocations, want exactly 1 (idempotency)", len(all), "fixed-key-123")
	}
}
