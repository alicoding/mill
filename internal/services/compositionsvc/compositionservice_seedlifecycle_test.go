package compositionsvc

import (
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/seedorigin"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// docs/goals/0037's Proofs section, against real (fake-store-backed,
// same servicetest harness every other compositionsvc test uses)
// CompositionService instances.

// firstGoldenID returns the ID of the first built-in workflow -- every
// test below just needs SOME real, currently-shipped golden, not a
// specific one.
func firstGoldenID(t *testing.T) string {
	t.Helper()
	all := composition.BuiltInWorkflows()
	if len(all) == 0 {
		t.Fatal("no built-in workflows to test against")
	}
	return all[0].ID
}

// TestFreshInstall_SeedsWithUnmodifiedSeedOrigin: every golden a fresh
// install seeds carries SeedOrigin{SeedRevision: 1, Modified: false} --
// the baseline every other test in this file builds on.
func TestFreshInstall_SeedsWithUnmodifiedSeedOrigin(t *testing.T) {
	c := NewCompositionService(servicetest.NewFakeStore())
	id := firstGoldenID(t)
	for _, wf := range c.Workflows() {
		if wf.ID == id {
			if wf.Seed.SeedRevision != 1 || wf.Seed.Modified {
				t.Fatalf("fresh-install golden %q Seed = %+v, want {1 false}", id, wf.Seed)
			}
			return
		}
	}
	t.Fatalf("fresh-install workflows missing golden %q", id)
}

// TestUpdateWorkflow_SetsModifiedLatch_UIPath: a direct UI-RPC content
// edit reaching a built-in-origin workflow latches Modified -- the
// UpdateWorkflow choke point (docs/goals/0037 item 2).
func TestUpdateWorkflow_SetsModifiedLatch_UIPath(t *testing.T) {
	c := NewCompositionService(servicetest.NewFakeStore())
	id := firstGoldenID(t)

	updated, err := c.UpdateWorkflow(id, "Edited label", "edited", []composition.Node{{ID: "t", NodeTypeID: "trigger-manual"}}, nil)
	if err != nil {
		t.Fatalf("UpdateWorkflow: %v", err)
	}
	if !updated.Seed.Modified {
		t.Fatal("UpdateWorkflow on a built-in-origin workflow did not latch Modified")
	}
	if updated.Seed.SeedRevision != 1 {
		t.Fatalf("SeedRevision changed unexpectedly on edit: got %d, want 1 preserved", updated.Seed.SeedRevision)
	}
}

// TestUpdateWorkflowFromExport_SetsModifiedLatch_MCPPath: the MCP
// update_workflow tool's actual entry point into CompositionService
// (millmcpservice_authoring.go calls this exact method) also latches
// Modified -- proving the choke point covers the MCP write path too,
// not just the direct UI RPC (docs/goals/0037's "Unit" proof).
func TestUpdateWorkflowFromExport_SetsModifiedLatch_MCPPath(t *testing.T) {
	c := NewCompositionService(servicetest.NewFakeStore())
	id := firstGoldenID(t)

	exported, err := c.ExportWorkflow(id)
	if err != nil {
		t.Fatalf("ExportWorkflow: %v", err)
	}
	updated, err := c.UpdateWorkflowFromExport(id, exported)
	if err != nil {
		t.Fatalf("UpdateWorkflowFromExport: %v", err)
	}
	if !updated.Seed.Modified {
		t.Fatal("UpdateWorkflowFromExport (the MCP update_workflow path) did not latch Modified")
	}
}

// TestMutateWorkflow_SetsModifiedLatch: every mutateWorkflow caller
// (Publish/PublishExistingVersion/RestoreVersionToDraft/
// SetWorkflowDisabled/SnapshotDraft) routes through the one choke
// point -- checked via SetWorkflowDisabled, standing in for the whole
// family (they all share the exact same latch line).
func TestMutateWorkflow_SetsModifiedLatch(t *testing.T) {
	c := NewCompositionService(servicetest.NewFakeStore())
	id := firstGoldenID(t)

	updated, err := c.SetWorkflowDisabled(id, true)
	if err != nil {
		t.Fatalf("SetWorkflowDisabled: %v", err)
	}
	if !updated.Seed.Modified {
		t.Fatal("SetWorkflowDisabled (a mutateWorkflow caller) did not latch Modified")
	}
}

// TestUpgradeWorkflowToGolden_AppendsPublishedVersionFromGolden proves
// the exact mechanics reconcileBuiltIns' upgrade branch AND
// ResetWorkflowToSeed both call: golden content becomes a new
// published version, history is preserved (not overwritten), and the
// Seed stamp lands at the golden's revision, Modified cleared.
func TestUpgradeWorkflowToGolden_AppendsPublishedVersionFromGolden(t *testing.T) {
	existing := composition.Workflow{
		ID: "seed-wf", Label: "Old label", BuiltIn: true,
		Nodes: []composition.Node{{ID: "t", NodeTypeID: "trigger-manual"}},
		Seed:  seedorigin.Origin{SeedRevision: 1, Modified: false},
	}
	existing = composition.PublishHead(existing, time.Now()) // v1, matching a real seeded/migratePublish'd workflow

	golden := composition.Workflow{
		ID: "seed-wf", Label: "New label (golden rev 2)", BuiltIn: true,
		Nodes: []composition.Node{{ID: "t", NodeTypeID: "trigger-manual"}, {ID: "t2", NodeTypeID: "trigger-manual"}},
		Seed:  seedorigin.Origin{SeedRevision: 2},
	}

	before := len(existing.Versions)
	updated := upgradeWorkflowToGolden(existing, golden, time.Now())

	if len(updated.Versions) != before+1 {
		t.Fatalf("Versions length = %d, want %d (history grows by one, never overwritten)", len(updated.Versions), before+1)
	}
	published, ok := composition.VersionByNumber(updated, updated.PublishedVersion)
	if !ok {
		t.Fatalf("PublishedVersion %d has no matching snapshot", updated.PublishedVersion)
	}
	if published.Label != golden.Label || len(published.Nodes) != len(golden.Nodes) {
		t.Fatalf("published version content = %+v, want golden's content %+v", published, golden)
	}
	if updated.Seed.SeedRevision != 2 || updated.Seed.Modified {
		t.Fatalf("Seed after upgrade = %+v, want {2 false}", updated.Seed)
	}
	if updated.ID != existing.ID {
		t.Fatalf("upgrade must preserve identity: ID changed from %q to %q", existing.ID, updated.ID)
	}
}

// TestReconcileBuiltIns_ModifiedEntryLeftAlone: a golden the user has
// edited (Modified: true) is never touched by reconcile, regardless of
// its stored revision relative to the shipped one -- the write-time
// latch is the sole authority (docs/goals/0037's core design point:
// never re-derived from a content diff).
func TestReconcileBuiltIns_ModifiedEntryLeftAlone(t *testing.T) {
	store := servicetest.NewFakeStore()
	c := NewCompositionService(store)
	id := firstGoldenID(t)

	edited, err := c.UpdateWorkflow(id, "User's own edit", "", []composition.Node{{ID: "t", NodeTypeID: "trigger-manual"}}, nil)
	if err != nil {
		t.Fatalf("UpdateWorkflow: %v", err)
	}
	if !edited.Seed.Modified {
		t.Fatal("precondition failed: edit did not latch Modified")
	}

	// Simulate the next app launch reading the same persisted store.
	c2 := NewCompositionService(store)
	for _, wf := range c2.Workflows() {
		if wf.ID == id {
			if wf.Label != "User's own edit" {
				t.Fatalf("reconcile touched a Modified built-in: Label = %q, want the user's edit preserved", wf.Label)
			}
			if !wf.Seed.Modified {
				t.Fatal("Modified latch did not survive a restart")
			}
			return
		}
	}
	t.Fatalf("workflow %q missing after restart", id)
}

// TestReconcileBuiltIns_MigratesPreGoal0037Entry: an existing entry
// whose ID matches a golden but carries no SeedOrigin at all
// (SeedRevision == 0 -- predates this feature) is migration-stamped
// Modified: true, never silently upgraded (docs/goals/0037 item 6:
// conservative by design).
func TestReconcileBuiltIns_MigratesPreGoal0037Entry(t *testing.T) {
	store := servicetest.NewFakeStore()
	id := firstGoldenID(t)

	// Simulate a pre-goal-0037 persisted install: the golden's exact
	// shape but with a zero-value Seed, written directly to the store
	// (bypassing the constructor, which would stamp it).
	pre := composition.BuiltInWorkflows()[0]
	pre.Seed = seedorigin.Origin{}
	seedPreExistingStore(t, store, []composition.Workflow{pre})

	c := NewCompositionService(store)
	for _, wf := range c.Workflows() {
		if wf.ID == id {
			if wf.Seed.SeedRevision != 1 || !wf.Seed.Modified {
				t.Fatalf("migration stamp = %+v, want {1 true} (conservative: never auto-clobber pre-existing data)", wf.Seed)
			}
			return
		}
	}
	t.Fatalf("workflow %q missing after migration reconcile", id)
}

// TestResetWorkflowToSeed_ClearsModifiedAndAppendsGoldenVersion: the
// explicit, on-demand reset affordance (docs/goals/0037 item 4) --
// starting from a real Modified workflow (via the same UpdateWorkflow
// path a user's edit would take), Reset restores golden content as a
// NEW version (previous history untouched) and clears the latch.
func TestResetWorkflowToSeed_ClearsModifiedAndAppendsGoldenVersion(t *testing.T) {
	c := NewCompositionService(servicetest.NewFakeStore())
	id := firstGoldenID(t)
	golden := composition.BuiltInWorkflows()[0]

	edited, err := c.UpdateWorkflow(id, "User's own edit", "", []composition.Node{{ID: "t", NodeTypeID: "trigger-manual"}}, nil)
	if err != nil {
		t.Fatalf("UpdateWorkflow: %v", err)
	}
	versionsBeforeReset := len(edited.Versions)

	reset, err := c.ResetWorkflowToSeed(id)
	if err != nil {
		t.Fatalf("ResetWorkflowToSeed: %v", err)
	}
	if reset.Seed.Modified {
		t.Fatal("ResetWorkflowToSeed did not clear the Modified latch")
	}
	if reset.Label != golden.Label {
		t.Fatalf("Label after reset = %q, want golden's %q", reset.Label, golden.Label)
	}
	if len(reset.Versions) != versionsBeforeReset+1 {
		t.Fatalf("Versions length = %d, want %d (reset appends, never truncates history)", len(reset.Versions), versionsBeforeReset+1)
	}
	published, ok := composition.VersionByNumber(reset, reset.PublishedVersion)
	if !ok || published.Label != golden.Label {
		t.Fatalf("published version after reset = %+v (ok=%v), want golden content", published, ok)
	}
}

// TestRestoreWorkflow_TombstoneRoundTrip: delete a built-in (tombstoned,
// gone) -> it shows up as restorable -> restoring it clears the
// tombstone and brings it back at the current golden revision
// (docs/goals/0037 item 5).
func TestRestoreWorkflow_TombstoneRoundTrip(t *testing.T) {
	c := NewCompositionService(servicetest.NewFakeStore())
	id := firstGoldenID(t)

	if err := c.DeleteWorkflow(id); err != nil {
		t.Fatalf("DeleteWorkflow: %v", err)
	}
	for _, wf := range c.Workflows() {
		if wf.ID == id {
			t.Fatalf("workflow %q still present after delete", id)
		}
	}

	restorable := c.RestorableWorkflows()
	found := false
	for _, wf := range restorable {
		if wf.ID == id {
			found = true
		}
	}
	if !found {
		t.Fatalf("RestorableWorkflows() missing tombstoned %q: %+v", id, restorable)
	}

	restored, err := c.RestoreWorkflow(id)
	if err != nil {
		t.Fatalf("RestoreWorkflow: %v", err)
	}
	if restored.ID != id || restored.Seed.Modified || restored.Seed.SeedRevision != 1 {
		t.Fatalf("RestoreWorkflow result = %+v, want present/unmodified/rev 1", restored)
	}
	found = false
	for _, wf := range c.Workflows() {
		if wf.ID == id {
			found = true
		}
	}
	if !found {
		t.Fatalf("workflow %q missing after RestoreWorkflow", id)
	}
	for _, wf := range c.RestorableWorkflows() {
		if wf.ID == id {
			t.Fatalf("workflow %q still listed as restorable after being restored", id)
		}
	}
}

// seedPreExistingStore writes workflows directly to store under
// workflowsKey, bypassing the constructor -- used to simulate data
// that predates this feature (TestReconcileBuiltIns_MigratesPreGoal0037Entry).
func seedPreExistingStore(t *testing.T, store *servicetest.FakeStore, workflows []composition.Workflow) {
	t.Helper()
	c := &CompositionService{store: store, user: workflows}
	if err := c.persist(); err != nil {
		t.Fatalf("seedPreExistingStore persist: %v", err)
	}
}
