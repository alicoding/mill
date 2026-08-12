package triggersvc

import (
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/executionsvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// docs/SPEC.md §2.1/§5 (the save-page capture floor): proves Part A (a
// trigger fire's own event data becomes the run's starting payload --
// composition.ExecuteOptions.InitialPayload / RunWorkflowWithPayload),
// Part B (htmlextract drops chrome, keeps only the matched subtree),
// and Part D (capture-file's "payload" mode reads the fired path) all
// together, against the REAL seeded "Example: Saved page -> Markdown"
// workflow's own graph -- not a hand-built look-alike. Mirrors
// TestSeededDisabledFilesystemWatch_FiresRealWorkflowOnFileCreate's own
// shape: re-point the seed's watch path at a real temp dir, enable +
// publish, drop a fixture file, wait for a real triggered run.
//
// The seed's LAST step (apply-clipboard-write-text) writes the real
// macOS clipboard, which internal/adapters/clipboard's own tests treat
// as CI-hostile (GitHub's macos-latest runners are headless -- no GUI/
// pasteboard session for osascript/pbcopy). Rather than skip this test
// outright, it asserts on the process-html-to-markdown step's own
// checkpointed output (via GetRun) -- DBOS records each step's result
// independently, so this proof holds whether or not the later apply
// step's clipboard write itself succeeds in a given environment.
func TestSeededSavedPageToMarkdown_FiresRealWorkflowAndExtractsMainContent(t *testing.T) {
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
	t.Cleanup(func() {
		s.Sync(nil) // stop every listener this test starts
		_ = exec.Shutdown(2 * time.Second)
	})

	var seed composition.Workflow
	for _, wf := range comp.Workflows() {
		if wf.Label == "Example: Saved page → Markdown" {
			seed = wf
		}
	}
	if seed.ID == "" {
		t.Fatal(`no built-in workflow labeled "Example: Saved page → Markdown"`)
	}

	// Point the seed's own graph at a real directory instead of its
	// shipped placeholder path -- editing the draft head only
	// (UpdateWorkflow), same as any real user pointing this trigger
	// somewhere real via the canvas Inspector.
	watchDir := t.TempDir()
	newNodes := make([]composition.Node, len(seed.Nodes))
	copy(newNodes, seed.Nodes)
	for i, n := range newNodes {
		if n.NodeTypeID == "trigger-filesystem-watch" {
			cfg := make(map[string]string, len(n.Config))
			for k, v := range n.Config {
				cfg[k] = v
			}
			cfg["path"] = watchDir
			newNodes[i].Config = cfg
		}
	}
	if _, err := comp.UpdateWorkflow(seed.ID, seed.Label, seed.Description, newNodes, seed.Edges); err != nil {
		t.Fatalf("UpdateWorkflow: %v", err)
	}
	// Publish BEFORE enabling -- this seed's own placeholder path
	// (~/Mill Captures, a real-looking string unlike the disabled
	// fs-watch seed's belt-and-suspenders empty path) is non-empty, and
	// compositionservice_versioning.go's migratePublish() auto-publishes
	// any zero-version built-in as v1 at construction time using
	// whatever the head looked like then -- publishing first means
	// SetWorkflowDisabled's own Sync call only ever arms against the
	// already-repointed version, never a stale v1 snapshot of the
	// original placeholder.
	if _, err := comp.PublishWorkflow(seed.ID); err != nil {
		t.Fatalf("PublishWorkflow: %v", err)
	}
	if _, err := comp.SetWorkflowDisabled(seed.ID, false); err != nil {
		t.Fatalf("SetWorkflowDisabled(false): %v", err)
	}

	if !s.ArmedWorkflows()[seed.ID] {
		t.Fatal("the re-pointed, enabled, published seed is not armed, want ArmedWorkflows() to report it live")
	}

	// A fake Confluence-ish saved page: real nav/header/footer chrome
	// around a real #main-content region -- proves extraction keeps the
	// content and drops the chrome, not just that SOME markdown came out.
	const fixtureHTML = `<html><body>
<nav>Site navigation chrome</nav>
<header>Site header chrome</header>
<main id="main-content">
<h1>Quarterly planning notes</h1>
<ul><li>Ship the capture floor</li></ul>
</main>
<footer>Site footer chrome</footer>
</body></html>`
	if err := os.WriteFile(filepath.Join(watchDir, "saved-page.html"), []byte(fixtureHTML), 0o600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		runs, err := exec.ListRunsForWorkflow(seed.ID)
		if err == nil {
			for _, r := range runs {
				if r.Kind != executionsvc.RunKindTriggered {
					continue
				}
				detail, err := exec.GetRun(r.RunID)
				if err != nil {
					continue
				}
				for _, step := range detail.Steps {
					if step.NodeTypeID != "process-html-to-markdown" || step.Status != "succeeded" {
						continue
					}
					if !strings.Contains(step.Output, "Quarterly planning notes") {
						t.Fatalf("markdown step output = %q, want it to contain the main-content heading", step.Output)
					}
					if strings.Contains(step.Output, "Site navigation chrome") || strings.Contains(step.Output, "Site footer chrome") {
						t.Fatalf("markdown step output = %q, want the nav/footer chrome dropped", step.Output)
					}
					return // proof complete: real trigger fire -> real payload -> extracted-and-converted content
				}
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatal("no triggered run's process-html-to-markdown step ever reached succeeded with the expected extracted content")
}
