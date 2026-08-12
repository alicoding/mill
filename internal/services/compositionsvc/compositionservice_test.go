package compositionsvc

import (
	"errors"
	"testing"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// errFakePersist is the injected failure servicetest.FakeStore.SetErr
// returns for the persist-failure tests below.
var errFakePersist = errors.New("fake persist failure")

// docs/adr/0021: a draft save must never wipe lifecycle state -- the
// exact bug shape UpdateWorkflow's rebuild-the-struct pattern invites
// (BuiltIn needed the same carry-forward once already).
func TestUpdateWorkflow_PreservesLifecycleState(t *testing.T) {
	store := servicetest.NewFakeStore()
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

// docs/goals/0025 items 1/2: persist() used to swallow its error
// (`_ = c.store.Set(...)`), so a real store failure was both invisible
// to the caller AND left the in-memory c.user slice already mutated --
// a phantom-saved workflow the UI would show as created even though
// nothing was actually written. servicetest.FakeStore.SetErr makes
// this class of bug reproducible for the first time; these three cases
// cover Create/Update/Delete.

func TestCreateWorkflow_PersistFailure_ReturnsErrorAndDoesNotPhantomSave(t *testing.T) {
	store := servicetest.NewFakeStore()
	c := NewCompositionService(store)
	before := len(c.Workflows())

	store.SetErr = errFakePersist
	_, err := c.CreateWorkflow("Should not stick", "", []composition.Node{{ID: "t", NodeTypeID: "trigger-manual"}}, nil)
	if err == nil {
		t.Fatal("CreateWorkflow() with a failing store: want error, got nil")
	}

	after := c.Workflows()
	if len(after) != before {
		t.Errorf("Workflows() after a failed persist has %d entries, want %d (unchanged) -- a phantom-saved workflow was left in memory", len(after), before)
	}
	for _, wf := range after {
		if wf.Label == "Should not stick" {
			t.Error("Workflows() contains the workflow whose persist failed")
		}
	}
}

func TestUpdateWorkflow_PersistFailure_ReturnsErrorAndRollsBack(t *testing.T) {
	store := servicetest.NewFakeStore()
	c := NewCompositionService(store)
	wf, err := c.CreateWorkflow("Original label", "", []composition.Node{{ID: "t", NodeTypeID: "trigger-manual"}}, nil)
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}

	store.SetErr = errFakePersist
	_, err = c.UpdateWorkflow(wf.ID, "Edited label", "", []composition.Node{{ID: "t", NodeTypeID: "trigger-manual"}}, nil)
	if err == nil {
		t.Fatal("UpdateWorkflow() with a failing store: want error, got nil")
	}

	store.SetErr = nil
	for _, got := range c.Workflows() {
		if got.ID == wf.ID {
			if got.Label != "Original label" {
				t.Errorf("Workflows()[%s].Label = %q after a failed UpdateWorkflow, want the original %q (rolled back)", wf.ID, got.Label, "Original label")
			}
			return
		}
	}
	t.Fatalf("Workflows() no longer contains %s after a failed UpdateWorkflow", wf.ID)
}

func TestDeleteWorkflow_PersistFailure_ReturnsErrorAndRestoresIt(t *testing.T) {
	store := servicetest.NewFakeStore()
	c := NewCompositionService(store)
	wf, err := c.CreateWorkflow("Should survive the failed delete", "", []composition.Node{{ID: "t", NodeTypeID: "trigger-manual"}}, nil)
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}

	store.SetErr = errFakePersist
	if err := c.DeleteWorkflow(wf.ID); err == nil {
		t.Fatal("DeleteWorkflow() with a failing store: want error, got nil")
	}

	store.SetErr = nil
	for _, got := range c.Workflows() {
		if got.ID == wf.ID {
			return
		}
	}
	t.Fatalf("Workflows() no longer contains %s after a failed DeleteWorkflow -- the removal was not rolled back", wf.ID)
}
