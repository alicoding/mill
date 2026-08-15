package triggersvc

import (
	"log/slog"
	"path/filepath"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/atlassvc"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/executionsvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// TestSeededCardIntakeKindID_MatchesAtlasSeed guards against the literal
// ID copy composition/builtinworkflows_atlascard.go carries (composition
// can't import internal/domain/atlas -- that package already imports
// composition, see atlascard.go's own doc comment) drifting silently
// out of sync with the real seeded Kind/LinkKind it names.
func TestSeededCardIntakeKindID_MatchesAtlasSeed(t *testing.T) {
	store := servicetest.NewFakeStore()
	atlasSvc := atlassvc.NewAtlasService(store)

	var haveKind, haveLinkKind bool
	for _, k := range atlasSvc.Kinds() {
		if k.ID == "atlas-kind-intake" {
			haveKind = true
		}
	}
	for _, lk := range atlasSvc.LinkKinds() {
		if lk.ID == "atlas-linkkind-relates-to" {
			haveLinkKind = true
		}
	}
	if !haveKind {
		t.Error(`no seeded atlas Kind with id "atlas-kind-intake" -- composition/builtinworkflows_atlascard.go's atlasIntakeKindID literal is now stale`)
	}
	if !haveLinkKind {
		t.Error(`no seeded atlas LinkKind with id "atlas-linkkind-relates-to" -- composition/builtinworkflows_atlascard.go's atlasRelatesToLinkKindID literal is now stale`)
	}
}

// TestSeededCardIntakeExample_TriggerUpdatesOwnCardAndDoesNotLoop runs
// the real seeded "Example: Card intake" workflow (goal 0066, ADR-0035/
// 0038) fully wired -- AtlasService, CompositionService, TriggerService,
// ExecutionService -- the same cross-service shape
// TestSeededDisabledFilesystemWatch_FiresRealWorkflowOnFileCreate
// already establishes for a different trigger family. Creating an
// Intake card fires the trigger; the workflow's own
// apply-atlas-card-update step writes right back to that same card,
// which is exactly the cycle the guard (docs/goals/0066) exists to
// stop: only ONE triggered run may ever appear, and the card ends up
// stamped "Processed".
func TestSeededCardIntakeExample_TriggerUpdatesOwnCardAndDoesNotLoop(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	s := NewTriggerService(comp, slog.Default(), store)
	comp.SetSyncer(s)

	guard := guardrailsvc.NewGuardrailService(store, comp)
	dbPath := filepath.Join(t.TempDir(), "exec.db")
	exec, err := executionsvc.NewExecutionService("sqlite:"+dbPath, comp, guard)
	if err != nil {
		t.Fatalf("NewExecutionService: %v", err)
	}
	s.SetExecutionService(exec)

	atlasSvc := atlassvc.NewAtlasService(store)
	atlasSvc.WireCompositionSeams(s.DispatchAtlasCardChange)

	t.Cleanup(func() {
		s.Sync(nil) // stop every listener this test starts
		_ = exec.Shutdown(2 * time.Second)
	})

	var seed composition.Workflow
	for _, wf := range comp.Workflows() {
		if wf.Label == "Example: Card intake" {
			seed = wf
		}
	}
	if seed.ID == "" {
		t.Fatal(`no built-in workflow labeled "Example: Card intake"`)
	}
	if _, err := comp.PublishWorkflow(seed.ID); err != nil {
		t.Fatalf("PublishWorkflow: %v", err)
	}
	if !s.ArmedWorkflows()[seed.ID] {
		t.Fatal("the published seed is not armed, want ArmedWorkflows() to report it live")
	}

	card, err := atlasSvc.CreateCard("atlas-kind-intake", "New lead", "", map[string]string{"status": "New"}, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}

	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		runs, err := exec.ListRunsForWorkflow(seed.ID)
		if err == nil && len(triggeredRuns(runs)) > 0 {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}

	// Give a would-be (incorrect) second fire time to also land before
	// counting -- the guard's whole claim is that this window stays
	// empty, not just that the FIRST run appears.
	time.Sleep(500 * time.Millisecond)

	runs, err := exec.ListRunsForWorkflow(seed.ID)
	if err != nil {
		t.Fatalf("ListRunsForWorkflow: %v", err)
	}
	triggered := triggeredRuns(runs)
	if len(triggered) != 1 {
		t.Fatalf("cycle guard failed: %d triggered runs for the seed, want exactly 1 (%+v)", len(triggered), triggered)
	}
	if triggered[0].Status != "SUCCESS" {
		t.Fatalf("triggered run status = %q (error %q), want SUCCESS", triggered[0].Status, triggered[0].Error)
	}

	found := false
	for _, c := range atlasSvc.CardsByKind("atlas-kind-intake") {
		if c.ID == card.ID {
			found = true
			if c.Fields["status"] != "Processed" {
				t.Fatalf("card status = %q, want %q (the trigger's own update)", c.Fields["status"], "Processed")
			}
		}
	}
	if !found {
		t.Fatal("the source card no longer exists after the run")
	}
}

func triggeredRuns(runs []executionsvc.RunSummary) []executionsvc.RunSummary {
	var out []executionsvc.RunSummary
	for _, r := range runs {
		if r.Kind == executionsvc.RunKindTriggered {
			out = append(out, r)
		}
	}
	return out
}
