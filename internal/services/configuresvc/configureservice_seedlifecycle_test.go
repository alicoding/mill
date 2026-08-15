package configuresvc

import (
	"testing"

	"github.com/alicoding/mill/internal/adapters/credential"
	"github.com/alicoding/mill/internal/domain/decision"
	"github.com/alicoding/mill/internal/domain/httprequest"
	"github.com/alicoding/mill/internal/domain/list"
	"github.com/alicoding/mill/internal/domain/seedorigin"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// docs/goals/0037's Proofs section for Configure entities. HTTPRequest
// is exercised in full (representative -- reconcile/reset/restore/
// migration/latch, all sharing the exact same algorithm as every other
// entity type, upgradeXToGolden's own doc comments); List and Decision
// each get one targeted test for their own entity-specific wrinkles
// (List: Rows replace wholesale on reset; Decision: category
// immutability interacting with the latch).

func newConfigureHarness(t *testing.T) (*ConfigureService, *servicetest.FakeStore) {
	t.Helper()
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	return NewConfigureService(store, comp, credential.New()), store
}

func TestFreshInstall_RequestsHaveUnmodifiedSeedOrigin(t *testing.T) {
	cfg, _ := newConfigureHarness(t)
	id := httprequest.ExampleNoneID
	for _, r := range cfg.HTTPRequests() {
		if r.ID == id {
			if r.Seed.SeedRevision != 1 || r.Seed.Modified {
				t.Fatalf("fresh-install golden %q Seed = %+v, want {1 false}", id, r.Seed)
			}
			return
		}
	}
	t.Fatalf("fresh-install requests missing golden %q", id)
}

func TestUpdateHTTPRequest_SetsModifiedLatch(t *testing.T) {
	cfg, _ := newConfigureHarness(t)
	id := httprequest.ExampleNoneID

	updated, err := cfg.UpdateHTTPRequest(id, "Edited", "https://example.com", "GET", "", httprequest.AuthNone, nil, "", nil, nil, "edited")
	if err != nil {
		t.Fatalf("UpdateHTTPRequest: %v", err)
	}
	if !updated.Seed.Modified {
		t.Fatal("UpdateHTTPRequest on a built-in-origin request did not latch Modified")
	}
}

func TestReconcileBuiltInRequests_ModifiedEntryLeftAlone(t *testing.T) {
	cfg, store := newConfigureHarness(t)
	id := httprequest.ExampleNoneID

	if _, err := cfg.UpdateHTTPRequest(id, "User's own edit", "https://example.com", "GET", "", httprequest.AuthNone, nil, "", nil, nil, ""); err != nil {
		t.Fatalf("UpdateHTTPRequest: %v", err)
	}

	// Simulate the next app launch reading the same persisted store.
	comp2 := compositionsvc.NewCompositionService(store)
	cfg2 := NewConfigureService(store, comp2, credential.New())
	for _, r := range cfg2.HTTPRequests() {
		if r.ID == id {
			if r.Label != "User's own edit" {
				t.Fatalf("reconcile touched a Modified built-in: Label = %q", r.Label)
			}
			return
		}
	}
	t.Fatalf("request %q missing after restart", id)
}

func TestReconcileBuiltInRequests_MigratesPreGoal0037Entry(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	// Pre-goal-0037 install: the golden's shape with a zero-value Seed,
	// written directly (bypassing the constructor's own reconcile).
	pre := httprequest.BuiltIn()
	for i := range pre {
		pre[i].Seed = seedorigin.Origin{}
	}
	seedPreExistingRequests(t, store, pre)

	cfg := NewConfigureService(store, comp, credential.New())
	id := httprequest.ExampleNoneID
	for _, r := range cfg.HTTPRequests() {
		if r.ID == id {
			if r.Seed.SeedRevision != 1 || !r.Seed.Modified {
				t.Fatalf("migration stamp = %+v, want {1 true}", r.Seed)
			}
			return
		}
	}
	t.Fatalf("request %q missing after migration reconcile", id)
}

func TestResetHTTPRequestToSeed_ClearsModifiedLatch(t *testing.T) {
	cfg, _ := newConfigureHarness(t)
	id := httprequest.ExampleNoneID
	golden, _ := findGoldenRequest(id)

	if _, err := cfg.UpdateHTTPRequest(id, "User's own edit", "https://example.com", "GET", "", httprequest.AuthNone, nil, "", nil, nil, ""); err != nil {
		t.Fatalf("UpdateHTTPRequest: %v", err)
	}

	reset, err := cfg.ResetHTTPRequestToSeed(id)
	if err != nil {
		t.Fatalf("ResetHTTPRequestToSeed: %v", err)
	}
	if reset.Seed.Modified {
		t.Fatal("ResetHTTPRequestToSeed did not clear the Modified latch")
	}
	if reset.Label != golden.Label || reset.BaseURL != golden.BaseURL {
		t.Fatalf("content after reset = %+v, want golden's %+v", reset, golden)
	}
}

func TestRestoreHTTPRequest_TombstoneRoundTrip(t *testing.T) {
	cfg, _ := newConfigureHarness(t)
	id := httprequest.ExampleNoneID

	// docs/adr/0040 decision 3: two seeded workflows still reference
	// this request, so the delete is blocked until both references are
	// gone first.
	for _, wfID := range []string{"example-guarded-http-workflow", "example-forward-approvals-workflow"} {
		if err := cfg.composition.DeleteWorkflow(wfID); err != nil {
			t.Fatalf("DeleteWorkflow(%q) (unblocking the reference): %v", wfID, err)
		}
	}
	if err := cfg.DeleteHTTPRequest(id); err != nil {
		t.Fatalf("DeleteHTTPRequest: %v", err)
	}
	for _, r := range cfg.HTTPRequests() {
		if r.ID == id {
			t.Fatalf("request %q still present after delete", id)
		}
	}

	found := false
	for _, r := range cfg.RestorableHTTPRequests() {
		if r.ID == id {
			found = true
		}
	}
	if !found {
		t.Fatalf("RestorableHTTPRequests() missing tombstoned %q", id)
	}

	restored, err := cfg.RestoreHTTPRequest(id)
	if err != nil {
		t.Fatalf("RestoreHTTPRequest: %v", err)
	}
	if restored.ID != id || restored.Seed.Modified || restored.Seed.SeedRevision != 1 {
		t.Fatalf("RestoreHTTPRequest result = %+v, want present/unmodified/rev 1", restored)
	}
	for _, r := range cfg.RestorableHTTPRequests() {
		if r.ID == id {
			t.Fatalf("request %q still listed as restorable after being restored", id)
		}
	}
}

// TestResetListToSeed_ReplacesRowsWholesale: a List's Reset must bring
// Rows back too, not just Label/Description/Columns -- the entity-
// specific wrinkle upgradeListToGolden's own doc comment names.
func TestResetListToSeed_ReplacesRowsWholesale(t *testing.T) {
	cfg, _ := newConfigureHarness(t)
	id := list.ExampleCountryCodesID
	golden, ok := findGoldenList(id)
	if !ok {
		t.Fatalf("no golden list %q", id)
	}

	if _, err := cfg.AddListRow(id, map[string]string{"code": "ZZ", "name": "User-added row"}); err != nil {
		t.Fatalf("AddListRow: %v", err)
	}
	edited, err := cfg.UpdateList(id, "User's own edit", "edited", golden.Columns, nil)
	if err != nil {
		t.Fatalf("UpdateList: %v", err)
	}
	if !edited.Seed.Modified {
		t.Fatal("editing rows/content did not latch Modified")
	}
	if len(edited.Rows) != len(golden.Rows)+1 {
		t.Fatalf("precondition failed: expected the extra user row present before reset")
	}

	reset, err := cfg.ResetListToSeed(id)
	if err != nil {
		t.Fatalf("ResetListToSeed: %v", err)
	}
	if reset.Seed.Modified {
		t.Fatal("ResetListToSeed did not clear the Modified latch")
	}
	if len(reset.Rows) != len(golden.Rows) {
		t.Fatalf("Rows after reset = %d, want golden's %d (wholesale replace)", len(reset.Rows), len(golden.Rows))
	}
}

// TestUpdateDecision_SetsModifiedLatch: Decision's own Update path
// (category-immutability check aside) still routes through the same
// latch.
func TestUpdateDecision_SetsModifiedLatch(t *testing.T) {
	cfg, _ := newConfigureHarness(t)
	id := decision.ExampleApproveID
	golden, ok := findGoldenDecision(id)
	if !ok {
		t.Fatalf("no golden decision %q", id)
	}

	updated, err := cfg.UpdateDecision(id, "Edited label", golden.Category, golden.Outputs, nil, golden.WebhookRequestID)
	if err != nil {
		t.Fatalf("UpdateDecision: %v", err)
	}
	if !updated.Seed.Modified {
		t.Fatal("UpdateDecision on a built-in-origin decision did not latch Modified")
	}

	reset, err := cfg.ResetDecisionToSeed(id)
	if err != nil {
		t.Fatalf("ResetDecisionToSeed: %v", err)
	}
	if reset.Seed.Modified || reset.Label != golden.Label {
		t.Fatalf("ResetDecisionToSeed result = %+v, want unmodified golden content", reset)
	}
}

// seedPreExistingRequests writes requests directly to store under
// requestsKey, bypassing the constructor -- used to simulate data that
// predates this feature.
func seedPreExistingRequests(t *testing.T, store *servicetest.FakeStore, requests []httprequest.HTTPRequest) {
	t.Helper()
	c := &ConfigureService{store: store, requests: requests}
	if err := c.persistHTTPRequests(); err != nil {
		t.Fatalf("seedPreExistingRequests persist: %v", err)
	}
}
