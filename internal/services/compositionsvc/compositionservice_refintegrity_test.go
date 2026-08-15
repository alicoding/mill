package compositionsvc

import (
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// WorkflowsReferencing is the reverse lookup docs/adr/0040 decision 3
// blocks a Configure-entity/workflow delete against -- proven here
// against a hand-built workflow (not seed-dependent) so the mechanism
// itself is covered independently of any particular seeded example.
func TestWorkflowsReferencing_FindsANodeConfigBinding(t *testing.T) {
	store := servicetest.NewFakeStore()
	c := NewCompositionService(store)

	wf, err := c.CreateWorkflow("Calls an MCP server", "", []composition.Node{
		{ID: "t", NodeTypeID: "trigger-manual"},
		{ID: "m", NodeTypeID: "mcp-tool-call", Config: map[string]string{"mcpServerId": "svr-under-test"}},
	}, []composition.Edge{{ID: "e1", Source: "t", Target: "m"}})
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}

	got := c.WorkflowsReferencing("mcpserver", "svr-under-test")
	if len(got) != 1 || got[0] != wf.Label {
		t.Fatalf("WorkflowsReferencing(mcpserver, svr-under-test) = %v, want [%q]", got, wf.Label)
	}
}

func TestWorkflowsReferencing_EmptyForAnUnreferencedID(t *testing.T) {
	store := servicetest.NewFakeStore()
	c := NewCompositionService(store)

	if got := c.WorkflowsReferencing("mcpserver", "nobody-references-this"); len(got) != 0 {
		t.Errorf("WorkflowsReferencing for an unreferenced id = %v, want empty", got)
	}
}

func TestWorkflowsReferencing_EmptyForBlankID(t *testing.T) {
	store := servicetest.NewFakeStore()
	c := NewCompositionService(store)

	if got := c.WorkflowsReferencing("mcpserver", ""); len(got) != 0 {
		t.Errorf("WorkflowsReferencing for a blank id (unconfigured, not dangling) = %v, want empty", got)
	}
}

// DeleteWorkflow applies the same reference-integrity rule to its own
// entity type: the seeded parent workflow's child-workflow node still
// pins the child by id, so deleting the child is blocked until that
// reference is gone.
func TestDeleteWorkflow_BlockedByChildWorkflowReference_NamesIt(t *testing.T) {
	store := servicetest.NewFakeStore()
	c := NewCompositionService(store)

	err := c.DeleteWorkflow(composition.ExampleChildWorkflowID)
	if err == nil {
		t.Fatal("DeleteWorkflow on a still-referenced child workflow returned nil error, want it blocked")
	}
	if !strings.Contains(err.Error(), "Example: Parent") {
		t.Errorf("DeleteWorkflow blocked-error = %q, want it to name the referencing parent workflow", err.Error())
	}

	if err := c.DeleteWorkflow("example-parent-workflow"); err != nil {
		t.Fatalf("DeleteWorkflow (unblocking the reference): %v", err)
	}
	if err := c.DeleteWorkflow(composition.ExampleChildWorkflowID); err != nil {
		t.Fatalf("DeleteWorkflow(%q) after unblocking: %v", composition.ExampleChildWorkflowID, err)
	}
}
