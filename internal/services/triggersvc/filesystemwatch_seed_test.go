package triggersvc

import (
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/executionsvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// docs/goals/0010 item 6: internal/adapters/filewatch's own
// TestWatch_FiresOnFileCreate already proves the raw fsnotify adapter
// fires against a real temp dir -- what was missing is proof at the
// trigger-service layer, running the REAL seeded
// "Example: Disabled filesystem watch" workflow's own node graph
// (trigger-filesystem-watch -> process-inject-text), not just the bare
// adapter. Ships with an empty path (never arms as shipped, same
// belt-and-suspenders reasoning the disabled-schedule seed already
// established) -- this test points a copy of that exact graph at a
// real temp directory, enables + publishes it, creates a file, and
// confirms a real triggered run actually executes end to end through
// the real DBOS-backed ExecutionService, the same way a live fire
// would.
func TestSeededDisabledFilesystemWatch_FiresRealWorkflowOnFileCreate(t *testing.T) {
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
		if wf.Label == "Example: Disabled filesystem watch" {
			seed = wf
		}
	}
	if seed.ID == "" {
		t.Fatal(`no built-in workflow labeled "Example: Disabled filesystem watch"`)
	}

	// Point the seed's own graph at a real directory instead of its
	// shipped empty path -- editing the draft head only
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
	if _, err := comp.SetWorkflowDisabled(seed.ID, false); err != nil {
		t.Fatalf("SetWorkflowDisabled(false): %v", err)
	}
	if _, err := comp.PublishWorkflow(seed.ID); err != nil {
		t.Fatalf("PublishWorkflow: %v", err)
	}

	if !s.ArmedWorkflows()[seed.ID] {
		t.Fatal("the re-pointed, enabled, published seed is not armed, want ArmedWorkflows() to report it live")
	}

	if err := os.WriteFile(filepath.Join(watchDir, "new-file.txt"), []byte("hello"), 0o600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		runs, err := exec.ListRunsForWorkflow(seed.ID)
		if err == nil {
			for _, r := range runs {
				if r.Kind == executionsvc.RunKindTriggered && r.Status == "SUCCESS" {
					return // found the real triggered run -- proof complete.
				}
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatal("no successful triggered run appeared for the re-pointed seed after creating a file in its watched directory")
}
