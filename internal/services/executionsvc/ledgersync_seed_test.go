package executionsvc

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/atlassvc"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

const ledgerSyncWorkflowID = "example-ledgersync-workflow"

func newLedgerSyncSeedFixture(t *testing.T) (*ExecutionService, *compositionsvc.CompositionService, *atlassvc.AtlasService) {
	t.Helper()
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	guard := guardrailsvc.NewGuardrailService(store, comp)
	dbPath := filepath.Join(t.TempDir(), "exec.db")
	exec, err := NewExecutionService("sqlite:"+dbPath, comp, guard)
	if err != nil {
		t.Fatalf("NewExecutionService: %v", err)
	}
	t.Cleanup(func() { _ = exec.Shutdown(2 * time.Second) })
	atlasSvc := atlassvc.NewAtlasService(store)
	atlasSvc.WireCompositionSeams(func(string, string, string, string, string) {})
	return exec, comp, atlasSvc
}

// pointLedgerSyncAt sets the seeded workflow's folderPath step config to
// dir -- the same "set the path on the step" user journey the docssync
// seed test drives.
func pointLedgerSyncAt(t *testing.T, comp *compositionsvc.CompositionService, dir string) {
	t.Helper()
	var wf composition.Workflow
	for _, w := range comp.Workflows() {
		if w.ID == ledgerSyncWorkflowID {
			wf = w
		}
	}
	if wf.ID == "" {
		t.Fatal("seeded ledger-sync workflow not found")
	}
	for i := range wf.Nodes {
		if wf.Nodes[i].NodeTypeID == "apply-atlas-ledger-sync" {
			wf.Nodes[i].Config["folderPath"] = dir
		}
	}
	if _, err := comp.UpdateWorkflow(wf.ID, wf.Label, wf.Description, wf.Nodes, wf.Edges); err != nil {
		t.Fatalf("UpdateWorkflow: %v", err)
	}
}

const testGoalFrontmatter = `---
id: "9001"
status: shipped
date: "2026-08-01"
prs: ["100"]
proof: ["TestFoo"]
spec_refs: ["1.1"]
---

# 9001 -- Test goal
`

// TestSeededLedgerSyncExample_MirrorsFolderIdempotently proves the goal
// 0164 L1 seed the way a user drives it: as shipped (empty folder path)
// the run fails with the honest folderPath-required error; after
// setting the path on the step, one run mirrors the frontmattered goal
// file into a Delivered feature card seeded pending-verify, and a
// second run (unchanged file) creates nothing new.
func TestSeededLedgerSyncExample_MirrorsFolderIdempotently(t *testing.T) {
	exec, comp, atlasSvc := newLedgerSyncSeedFixture(t)

	// As shipped: the empty path refuses loudly, never a silent no-op.
	if summary, err := exec.RunWorkflow(ledgerSyncWorkflowID, RunKindTest, nil); err == nil && summary.Status == "SUCCESS" {
		t.Fatalf("as-shipped run = %+v, want the folderPath-required failure", summary)
	}

	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "9001-test-goal.md"), []byte(testGoalFrontmatter), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	pointLedgerSyncAt(t, comp, dir)

	baseline := len(atlasSvc.Cards())
	summary, err := exec.RunWorkflow(ledgerSyncWorkflowID, RunKindTest, nil)
	if err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}
	if summary.Status != "SUCCESS" {
		t.Fatalf("summary = %+v, want SUCCESS", summary)
	}

	cards := atlasSvc.Cards()
	// One mirror card plus the created "Delivered features" parent.
	if len(cards) != baseline+2 {
		t.Fatalf("got %d cards after first sync, want %d", len(cards), baseline+2)
	}
	mirror := findLedgerMirrorCard(t, cards, dir)
	if mirror.Fields["goalId"] != "9001" {
		t.Errorf("goalId = %q, want %q", mirror.Fields["goalId"], "9001")
	}
	if mirror.Fields["shippedDate"] != "2026-08-01" {
		t.Errorf("shippedDate = %q, want %q", mirror.Fields["shippedDate"], "2026-08-01")
	}
	if mirror.Fields["prs"] != "100" {
		t.Errorf("prs = %q, want %q", mirror.Fields["prs"], "100")
	}
	if mirror.Fields["proof"] != "TestFoo" {
		t.Errorf("proof = %q, want %q", mirror.Fields["proof"], "TestFoo")
	}
	if mirror.Fields["signoff"] != "pending-verify" {
		t.Errorf("signoff = %q, want the seeded default %q", mirror.Fields["signoff"], "pending-verify")
	}
	if mirror.Fields["verifiedAt"] != "" {
		t.Errorf("verifiedAt = %q, want empty until sign-off actually happens", mirror.Fields["verifiedAt"])
	}

	// Idempotency: the second run over an unchanged file creates nothing.
	if _, err := exec.RunWorkflow(ledgerSyncWorkflowID, RunKindTest, nil); err != nil {
		t.Fatalf("second RunWorkflow: %v", err)
	}
	if got := len(atlasSvc.Cards()); got != baseline+2 {
		t.Fatalf("got %d cards after second sync, want unchanged %d", got, baseline+2)
	}
}

// TestLedgerSync_ReconcilePreservesOwnerFields is docs/goals/0164's
// BINDING reconcile-rule proof: sync a goal file in, set sign-off
// (stamping verifiedAt), change the file's frontmatter, and re-sync --
// the recorded sign-off and verified date must survive untouched while
// the mirror-owned fields (here, prs/proof) pick up the new content. A
// re-sync that clobbered signoff/verifiedAt would silently erase real
// verification work every time a goal file's header gets a mechanical
// touch-up.
func TestLedgerSync_ReconcilePreservesOwnerFields(t *testing.T) {
	exec, comp, atlasSvc := newLedgerSyncSeedFixture(t)

	dir := t.TempDir()
	fixture := filepath.Join(dir, "9001-test-goal.md")
	if err := os.WriteFile(fixture, []byte(testGoalFrontmatter), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	pointLedgerSyncAt(t, comp, dir)

	if _, err := exec.RunWorkflow(ledgerSyncWorkflowID, RunKindTest, nil); err != nil {
		t.Fatalf("first RunWorkflow: %v", err)
	}
	mirror := findLedgerMirrorCard(t, atlasSvc.Cards(), dir)

	// Evidence is reviewed and signed off, live in the app -- a manual
	// Atlas edit, UpdateCard's own path.
	signedOff := map[string]string{
		"goalId": mirror.Fields["goalId"], "shippedDate": mirror.Fields["shippedDate"],
		"prs": mirror.Fields["prs"], "proof": mirror.Fields["proof"],
		"signoff": "verified", "notes": "Checked the PR diff and the test run.",
	}
	updated, err := atlasSvc.UpdateCard(mirror.ID, mirror.Title, mirror.Note, signedOff, mirror.Source, mirror.MirrorPath, mirror.RefreshWorkflowID)
	if err != nil {
		t.Fatalf("UpdateCard (sign off): %v", err)
	}
	if updated.Fields["signoff"] != "verified" {
		t.Fatalf("signoff = %q after sign-off, want %q", updated.Fields["signoff"], "verified")
	}
	verifiedAt := updated.Fields["verifiedAt"]
	if verifiedAt == "" {
		t.Fatal("verifiedAt was not stamped when signoff left pending-verify")
	}

	// The goal file's own frontmatter changes -- a real, later edit
	// (a second PR lands, proof grows).
	changed := `---
id: "9001"
status: shipped
date: "2026-08-01"
prs: ["100", "101"]
proof: ["TestFoo", "TestBar"]
spec_refs: ["1.1"]
---

# 9001 -- Test goal
`
	if err := os.WriteFile(fixture, []byte(changed), 0o600); err != nil {
		t.Fatalf("rewrite fixture: %v", err)
	}

	if _, err := exec.RunWorkflow(ledgerSyncWorkflowID, RunKindTest, nil); err != nil {
		t.Fatalf("second RunWorkflow: %v", err)
	}
	reSynced := findLedgerMirrorCard(t, atlasSvc.Cards(), dir)

	// Mirror-owned fields picked up the new content.
	if reSynced.Fields["prs"] != "100, 101" {
		t.Errorf("prs after re-sync = %q, want %q", reSynced.Fields["prs"], "100, 101")
	}
	if reSynced.Fields["proof"] != "TestFoo, TestBar" {
		t.Errorf("proof after re-sync = %q, want %q", reSynced.Fields["proof"], "TestFoo, TestBar")
	}

	// Owner-owned fields survived the re-sync untouched -- the binding
	// reconcile rule.
	if reSynced.Fields["signoff"] != "verified" {
		t.Fatalf("signoff after re-sync = %q, want the recorded %q to survive", reSynced.Fields["signoff"], "verified")
	}
	if reSynced.Fields["verifiedAt"] != verifiedAt {
		t.Fatalf("verifiedAt after re-sync = %q, want the unchanged stamp %q", reSynced.Fields["verifiedAt"], verifiedAt)
	}
	if reSynced.Fields["notes"] != "Checked the PR diff and the test run." {
		t.Fatalf("notes after re-sync = %q, want the recorded note to survive", reSynced.Fields["notes"])
	}
}

// findLedgerMirrorCard returns the single card mirrored from a file
// under dir, failing the test if there isn't exactly one.
func findLedgerMirrorCard(t *testing.T, cards []atlas.Card, dir string) atlas.Card {
	t.Helper()
	var found []atlas.Card
	for _, c := range cards {
		if strings.HasPrefix(c.MirrorPath, dir) {
			found = append(found, c)
		}
	}
	if len(found) != 1 {
		t.Fatalf("found %d mirror cards under %q, want exactly 1", len(found), dir)
	}
	return found[0]
}
