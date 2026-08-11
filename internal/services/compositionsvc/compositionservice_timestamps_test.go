package compositionsvc

import (
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// docs/SPEC.md §3.2.2's reserved-column pattern, applied to Workflow:
// CreatedAt/UpdatedAt are system-managed, stamped server-side at every
// persisted mutation, never trusted from the wire. This file covers
// CompositionService's own stamping discipline end to end.

var manualTriggerNode = []composition.Node{{ID: "t", NodeTypeID: "trigger-manual"}}

func TestCreateWorkflow_StampsBothTimestamps(t *testing.T) {
	store := servicetest.NewFakeStore()
	c := NewCompositionService(store)

	before := time.Now()
	wf, err := c.CreateWorkflow("New wf", "", manualTriggerNode, nil)
	after := time.Now()
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}

	if wf.CreatedAt.IsZero() || wf.UpdatedAt.IsZero() {
		t.Fatalf("CreateWorkflow left a zero timestamp: CreatedAt=%v UpdatedAt=%v", wf.CreatedAt, wf.UpdatedAt)
	}
	if wf.CreatedAt.Before(before) || wf.CreatedAt.After(after) {
		t.Errorf("CreatedAt %v not within [%v, %v]", wf.CreatedAt, before, after)
	}
	if !wf.CreatedAt.Equal(wf.UpdatedAt) {
		t.Errorf("a freshly created workflow should have CreatedAt == UpdatedAt, got %v vs %v", wf.CreatedAt, wf.UpdatedAt)
	}
}

func TestUpdateWorkflow_PreservesCreatedAt_AdvancesUpdatedAt(t *testing.T) {
	store := servicetest.NewFakeStore()
	c := NewCompositionService(store)

	wf, err := c.CreateWorkflow("Update wf", "", manualTriggerNode, nil)
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}
	originalCreatedAt := wf.CreatedAt

	// Ensure a real, observable clock difference regardless of platform
	// timestamp resolution.
	time.Sleep(2 * time.Millisecond)

	updated, err := c.UpdateWorkflow(wf.ID, "Update wf (edited)", "new description", manualTriggerNode, nil)
	if err != nil {
		t.Fatalf("UpdateWorkflow: %v", err)
	}

	if !updated.CreatedAt.Equal(originalCreatedAt) {
		t.Errorf("UpdateWorkflow must preserve the stored CreatedAt, got %v want %v", updated.CreatedAt, originalCreatedAt)
	}
	if !updated.UpdatedAt.After(originalCreatedAt) {
		t.Errorf("UpdateWorkflow must advance UpdatedAt past the original stamp, got %v", updated.UpdatedAt)
	}

	// The RPC signature itself carries no CreatedAt/UpdatedAt parameter
	// at all -- there is no wire channel to forge one through. This is
	// the strongest form of "never trusted from the wire": structurally
	// unreachable, not just discarded.
}

func TestUpdateAttributes_AdvancesUpdatedAt_PreservesCreatedAt(t *testing.T) {
	store := servicetest.NewFakeStore()
	c := NewCompositionService(store)

	wf, err := c.CreateWorkflow("Attrs wf", "", manualTriggerNode, nil)
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}
	originalCreatedAt := wf.CreatedAt

	time.Sleep(2 * time.Millisecond)

	updated, err := c.UpdateAttributes(wf.ID, []composition.AttributeDef{{Key: "x", Label: "X", Type: "string"}})
	if err != nil {
		t.Fatalf("UpdateAttributes: %v", err)
	}
	if !updated.CreatedAt.Equal(originalCreatedAt) {
		t.Errorf("UpdateAttributes must preserve CreatedAt, got %v want %v", updated.CreatedAt, originalCreatedAt)
	}
	if !updated.UpdatedAt.After(originalCreatedAt) {
		t.Errorf("UpdateAttributes must advance UpdatedAt, got %v", updated.UpdatedAt)
	}
}

func TestPublishWorkflow_AdvancesUpdatedAt_PreservesCreatedAt(t *testing.T) {
	store := servicetest.NewFakeStore()
	c := NewCompositionService(store)

	wf, err := c.CreateWorkflow("Publish wf", "", manualTriggerNode, nil)
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}
	originalCreatedAt := wf.CreatedAt

	time.Sleep(2 * time.Millisecond)

	published, err := c.PublishWorkflow(wf.ID)
	if err != nil {
		t.Fatalf("PublishWorkflow: %v", err)
	}
	if !published.CreatedAt.Equal(originalCreatedAt) {
		t.Errorf("PublishWorkflow must preserve CreatedAt, got %v want %v", published.CreatedAt, originalCreatedAt)
	}
	if !published.UpdatedAt.After(originalCreatedAt) {
		t.Errorf("PublishWorkflow must advance UpdatedAt, got %v", published.UpdatedAt)
	}
}

func TestImportWorkflow_StampsFresh_IgnoringAnyWireTimestamp(t *testing.T) {
	store := servicetest.NewFakeStore()
	c := NewCompositionService(store)

	// exportedWorkflow carries no createdAt/updatedAt field at all, so a
	// hand-authored document trying to forge one is simply ignored by
	// json.Unmarshal (unknown fields are dropped) -- this asserts the
	// imported workflow gets a genuinely fresh stamp regardless.
	forgedDoc := `{
		"label": "Imported wf",
		"description": "",
		"nodes": [{"id": "t", "nodeTypeId": "trigger-manual"}],
		"edges": [],
		"attributes": [],
		"createdAt": "2001-01-01T00:00:00Z",
		"updatedAt": "2001-01-01T00:00:00Z"
	}`

	before := time.Now()
	wf, err := c.ImportWorkflow(forgedDoc)
	after := time.Now()
	if err != nil {
		t.Fatalf("ImportWorkflow: %v", err)
	}
	if wf.CreatedAt.Before(before) || wf.CreatedAt.After(after) {
		t.Errorf("ImportWorkflow's CreatedAt %v not within [%v, %v] -- a forged wire timestamp was trusted", wf.CreatedAt, before, after)
	}
	if !wf.CreatedAt.Equal(wf.UpdatedAt) {
		t.Errorf("a freshly imported workflow should have CreatedAt == UpdatedAt, got %v vs %v", wf.CreatedAt, wf.UpdatedAt)
	}
}

func TestSeededBuiltIns_AreStamped(t *testing.T) {
	store := servicetest.NewFakeStore()
	before := time.Now()
	c := NewCompositionService(store)
	after := time.Now()

	workflows := c.Workflows()
	if len(workflows) == 0 {
		t.Fatal("expected at least one seeded built-in workflow")
	}
	for _, wf := range workflows {
		if wf.CreatedAt.IsZero() || wf.UpdatedAt.IsZero() {
			t.Errorf("seeded workflow %q has a zero timestamp: CreatedAt=%v UpdatedAt=%v", wf.ID, wf.CreatedAt, wf.UpdatedAt)
		}
		if wf.CreatedAt.Before(before) || wf.CreatedAt.After(after) {
			t.Errorf("seeded workflow %q CreatedAt %v not within [%v, %v]", wf.ID, wf.CreatedAt, before, after)
		}
	}
}

// TestTopUpBuiltIns_StampsNewlyAddedWorkflow simulates an existing
// instance (persisted data already present, one workflow missing --
// the exact "a newly shipped example reaches existing instances" shape
// topUpBuiltIns exists for) and asserts the newly appended built-in
// gets a fresh stamp distinct from whatever an old persisted workflow
// already carried.
func TestTopUpBuiltIns_StampsNewlyAddedWorkflow(t *testing.T) {
	store := servicetest.NewFakeStore()

	all := composition.BuiltInWorkflows()
	if len(all) < 1 {
		t.Skip("no built-in workflows to test top-up against")
	}
	// Persist every built-in except the first, with a deliberately old
	// (pre-timestamp / legacy-shaped) zero-value CreatedAt/UpdatedAt --
	// migration-free legacy data.
	existing := append([]composition.Workflow{}, all[1:]...)
	c0 := NewCompositionService(store)
	// Directly seed the store to simulate "already persisted, missing
	// one built-in" rather than going through restore()'s own
	// first-launch path (which would seed everything).
	c0.mu.Lock()
	c0.user = existing
	c0.mu.Unlock()
	c0.persist()

	before := time.Now()
	c1 := NewCompositionService(store)
	after := time.Now()

	var found *composition.Workflow
	for _, wf := range c1.Workflows() {
		if wf.ID == all[0].ID {
			w := wf
			found = &w
			break
		}
	}
	if found == nil {
		t.Fatalf("top-up did not add missing built-in %q", all[0].ID)
	}
	if found.CreatedAt.Before(before) || found.CreatedAt.After(after) {
		t.Errorf("topped-up workflow %q CreatedAt %v not within [%v, %v]", found.ID, found.CreatedAt, before, after)
	}
}
