package main

import (
	"testing"

	"github.com/alicoding/mill/internal/domain/composition"
)

// docs/adr/0021: a draft save must never wipe lifecycle state -- the
// exact bug shape UpdateWorkflow's rebuild-the-struct pattern invites
// (BuiltIn needed the same carry-forward once already).
func TestUpdateWorkflow_PreservesLifecycleState(t *testing.T) {
	store := newFakeStore()
	c := NewCompositionService(store)

	wf, err := c.CreateWorkflow("Lifecycle wf", "", []composition.Node{{ID: "t", NodeTypeID: "trigger-manual"}}, nil)
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}
	if _, err := c.PublishWorkflow(wf.ID); err != nil {
		t.Fatalf("PublishWorkflow: %v", err)
	}
	if _, err := c.SetWorkflowDisabled(wf.ID, true); err != nil {
		t.Fatalf("SetWorkflowDisabled: %v", err)
	}

	updated, err := c.UpdateWorkflow(wf.ID, "Lifecycle wf (edited)", "", []composition.Node{{ID: "t", NodeTypeID: "trigger-manual"}}, nil)
	if err != nil {
		t.Fatalf("UpdateWorkflow: %v", err)
	}
	if updated.PublishedVersion != 1 || len(updated.Versions) != 1 || !updated.Disabled {
		t.Errorf("after draft save: PublishedVersion=%d Versions=%d Disabled=%v, want v1/1/true preserved",
			updated.PublishedVersion, len(updated.Versions), updated.Disabled)
	}
}
