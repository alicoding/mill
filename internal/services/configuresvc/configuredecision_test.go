package configuresvc

import (
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/adapters/credential"
	"github.com/alicoding/mill/internal/domain/decision"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

func newDecisionHarness(t *testing.T) *ConfigureService {
	t.Helper()
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	return NewConfigureService(store, comp, credential.New())
}

// docs/adr/0027, mirroring TestConfigureService_FreshInstall_SeedsBuiltInRequests:
// a fresh install seeds decision.BuiltIn()'s three examples.
func TestConfigureService_FreshInstall_SeedsBuiltInDecisions(t *testing.T) {
	cfg := newDecisionHarness(t)

	got := cfg.Decisions()
	want := decision.BuiltIn()
	if len(got) != len(want) {
		t.Fatalf("Decisions() on a fresh install = %d entries, want %d (decision.BuiltIn())", len(got), len(want))
	}
	seen := map[string]bool{}
	for _, d := range got {
		seen[d.ID] = true
	}
	for _, d := range want {
		if !seen[d.ID] {
			t.Errorf("fresh-install Decisions() missing built-in %q", d.ID)
		}
	}
}

// A deleted built-in Decision is tombstoned, so a later top-up call
// (simulating the next NewConfigureService construction, e.g. a
// restart) never resurrects it -- same discipline
// reconcileBuiltInRequests already has.
func TestConfigureService_DeletedBuiltInDecision_NotResurrectedByTopUp(t *testing.T) {
	cfg := newDecisionHarness(t)
	// docs/adr/0040 decision 3: the seeded "Example: Branch to a
	// decision" workflow still references this Decision, so the delete
	// is blocked, naming it, until that reference is gone.
	err := cfg.DeleteDecision(decision.ExampleApproveID)
	if err == nil {
		t.Fatal("DeleteDecision on a still-referenced decision returned nil error, want it blocked")
	}
	if !strings.Contains(err.Error(), "Route an expense by amount") {
		t.Errorf("DeleteDecision blocked-error = %q, want it to name the referencing workflow", err.Error())
	}
	if err := cfg.composition.DeleteWorkflow("example-branch-to-decision-workflow"); err != nil {
		t.Fatalf("DeleteWorkflow (unblocking the reference): %v", err)
	}
	if err := cfg.DeleteDecision(decision.ExampleApproveID); err != nil {
		t.Fatalf("DeleteDecision after unblocking: %v", err)
	}
	cfg.reconcileBuiltInDecisions()
	for _, d := range cfg.Decisions() {
		if d.ID == decision.ExampleApproveID {
			t.Fatal("reconcileBuiltInDecisions resurrected a deliberately deleted built-in Decision")
		}
	}
}

func TestCreateDecision_InvalidCategory_Rejected(t *testing.T) {
	cfg := newDecisionHarness(t)
	if _, err := cfg.CreateDecision("Bad", decision.Category("not-real"), nil, ""); err == nil {
		t.Fatal("CreateDecision with an invalid category returned nil error, want an error")
	}
}

func TestCreateDecision_ThenResolveDecision_RoundTrips(t *testing.T) {
	cfg := newDecisionHarness(t)
	outputs := []decision.OutputField{{Key: "note", Label: "Note", Type: "text"}}
	d, err := cfg.CreateDecision("My decision", decision.CategoryUncategorized, outputs, "")
	if err != nil {
		t.Fatalf("CreateDecision: %v", err)
	}
	rd, err := cfg.resolveDecision(d.ID, 0)
	if err != nil {
		t.Fatalf("resolveDecision: %v", err)
	}
	if rd.Label != "My decision" || rd.Category != "uncategorized" || len(rd.Outputs) != 1 {
		t.Fatalf("resolveDecision = %+v, want it to mirror the created Decision", rd)
	}
}

// The core immutability rule this brief exists to enforce: a category
// change is rejected server-side, not just discouraged in the UI.
func TestUpdateDecision_CategoryChange_Rejected(t *testing.T) {
	cfg := newDecisionHarness(t)
	d, err := cfg.CreateDecision("Mine", decision.CategoryApprove, nil, "")
	if err != nil {
		t.Fatalf("CreateDecision: %v", err)
	}
	_, err = cfg.UpdateDecision(d.ID, "Mine renamed", decision.CategoryDeny, nil, nil, "")
	if err == nil {
		t.Fatal("UpdateDecision changing category returned nil error, want an error")
	}
	if !strings.Contains(err.Error(), "cannot be changed") {
		t.Errorf("UpdateDecision category-change error = %q, want it to explain the immutability rule", err.Error())
	}
	// Confirm nothing was actually mutated.
	still := cfg.Decisions()
	for _, got := range still {
		if got.ID == d.ID && got.Category != decision.CategoryApprove {
			t.Fatalf("Decision %q category changed to %q despite the rejected update", d.ID, got.Category)
		}
	}
}

func TestUpdateDecision_SameCategory_Accepted(t *testing.T) {
	cfg := newDecisionHarness(t)
	d, err := cfg.CreateDecision("Mine", decision.CategoryApprove, nil, "")
	if err != nil {
		t.Fatalf("CreateDecision: %v", err)
	}
	updated, err := cfg.UpdateDecision(d.ID, "Mine renamed", decision.CategoryApprove,
		[]decision.OutputField{{Key: "x", Label: "X", Type: "text"}}, nil, "")
	if err != nil {
		t.Fatalf("UpdateDecision with the same category: %v", err)
	}
	if updated.Label != "Mine renamed" || len(updated.Outputs) != 1 {
		t.Fatalf("UpdateDecision result = %+v, want label/outputs updated", updated)
	}
}

// Regression: UpdateDecision built a fresh Decision{} literal without
// carrying Versions/PublishedVersion forward, so any edit to a
// published Decision silently erased its entire publish history --
// docs/adr/0040 decision 4 requires editing the draft to leave
// publish state untouched.
func TestUpdateDecision_PreservesVersionsAndPublishedVersion(t *testing.T) {
	cfg := newDecisionHarness(t)
	d, err := cfg.CreateDecision("Mine", decision.CategoryApprove,
		[]decision.OutputField{{Key: "x", Label: "X", Type: "text"}}, "")
	if err != nil {
		t.Fatalf("CreateDecision: %v", err)
	}
	published, err := cfg.PublishDecision(d.ID)
	if err != nil {
		t.Fatalf("PublishDecision: %v", err)
	}
	if published.PublishedVersion != 1 || len(published.Versions) != 1 {
		t.Fatalf("PublishDecision result = %+v, want PublishedVersion 1 and one snapshot", published)
	}

	updated, err := cfg.UpdateDecision(d.ID, "Mine renamed", decision.CategoryApprove,
		[]decision.OutputField{{Key: "x", Label: "X", Type: "text"}, {Key: "y", Label: "Y", Type: "text"}}, nil, "")
	if err != nil {
		t.Fatalf("UpdateDecision: %v", err)
	}
	if updated.PublishedVersion != 1 || len(updated.Versions) != 1 {
		t.Fatalf("UpdateDecision result = %+v, want PublishedVersion/Versions preserved from before the edit", updated)
	}
}

// No DuplicateDecision RPC exists (see configuredecision.go's own doc
// comment) -- duplication is client-side, the same as HTTPRequest's.
// The migration-path claim is instead proven at the Create layer: a
// second CreateDecision call with a different category from the same
// starting Label/Outputs succeeds, since it's a brand-new entity, not
// an update to the first one.
func TestCreateDecision_TwiceWithDifferentCategories_BothSucceed(t *testing.T) {
	cfg := newDecisionHarness(t)
	outputs := []decision.OutputField{{Key: "x", Label: "X", Type: "text"}}
	a, err := cfg.CreateDecision("Original", decision.CategoryApprove, outputs, "")
	if err != nil {
		t.Fatalf("CreateDecision(approve): %v", err)
	}
	b, err := cfg.CreateDecision("Original", decision.CategoryDeny, outputs, "")
	if err != nil {
		t.Fatalf("CreateDecision(deny) -- the 'duplicate then change category' path: %v", err)
	}
	if a.ID == b.ID {
		t.Fatal("two CreateDecision calls returned the same ID")
	}
}

func TestDeleteDecision_UnknownID_Errors(t *testing.T) {
	cfg := newDecisionHarness(t)
	if err := cfg.DeleteDecision("does-not-exist"); err == nil {
		t.Fatal("DeleteDecision with an unknown id returned nil error, want an error")
	}
}

// Export/Import mirrors ExportList/ExportMCPServer's own round-trip
// shape -- a new ID is always minted, never overwriting.
// TestExportImportDecision_KnownID_UpdatesInPlace pins ADR-0036
// decision 3's update path for Decision.
func TestExportImportDecision_KnownID_UpdatesInPlace(t *testing.T) {
	cfg := newDecisionHarness(t)
	before := len(cfg.Decisions()) // ADR-0027 seeds built-in decisions on a fresh install
	src, err := cfg.CreateDecision("Exportable", decision.CategoryDeny,
		[]decision.OutputField{{Key: "reason", Label: "Reason", Type: "text"}}, "")
	if err != nil {
		t.Fatalf("CreateDecision: %v", err)
	}
	data, err := cfg.ExportDecision(src.ID)
	if err != nil {
		t.Fatalf("ExportDecision: %v", err)
	}
	imported, err := cfg.ImportDecision(data)
	if err != nil {
		t.Fatalf("ImportDecision: %v", err)
	}
	if imported.ID != src.ID {
		t.Fatalf("ImportDecision.ID = %q, want the same id %q (update in place)", imported.ID, src.ID)
	}
	if imported.Label != src.Label || imported.Category != src.Category || len(imported.Outputs) != len(src.Outputs) {
		t.Fatalf("imported Decision = %+v, want it to mirror the exported source %+v", imported, src)
	}
	if got := len(cfg.Decisions()); got != before+1 {
		t.Fatalf("Decisions() has %d entries, want %d (updated in place, not duplicated)", got, before+1)
	}
}

// TestExportImportDecision_NoID_CreatesFresh covers decision 3's
// fresh-create path for Decision.
func TestExportImportDecision_NoID_CreatesFresh(t *testing.T) {
	cfg := newDecisionHarness(t)
	before := len(cfg.Decisions()) // ADR-0027 seeds built-in decisions on a fresh install
	src, err := cfg.CreateDecision("Exportable", decision.CategoryDeny,
		[]decision.OutputField{{Key: "reason", Label: "Reason", Type: "text"}}, "")
	if err != nil {
		t.Fatalf("CreateDecision: %v", err)
	}
	data, err := cfg.ExportDecision(src.ID)
	if err != nil {
		t.Fatalf("ExportDecision: %v", err)
	}
	fresh := stripIDField(t, data)

	imported, err := cfg.ImportDecision(fresh)
	if err != nil {
		t.Fatalf("ImportDecision: %v", err)
	}
	if imported.ID == src.ID {
		t.Fatal("ImportDecision of an id-less payload reused the source's ID -- should mint a fresh one")
	}
	if got := len(cfg.Decisions()); got != before+2 {
		t.Fatalf("Decisions() has %d entries, want %d", got, before+2)
	}
}
