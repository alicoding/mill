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

// TestSeededFileMoveExample_MovesRealFileIntoTemplatedDestination proves
// the real seeded "Example: File inbox to folder" workflow (goal 0087)
// end to end -- the watch -> classify -> file-into-place recipe --
// mirroring TestSeededDisabledFilesystemWatch_FiresRealWorkflowOnFileCreate's
// own harness (filesystemwatch_seed_test.go): point the trigger at a
// real temp directory and the apply-file-move step's own destination at
// a real folder under it (both ship as honest, non-functional
// placeholders), enable + publish, drop a matching file, and confirm it
// lands at the templated {date:2006-01}/{filename} destination through a
// real triggered run.
func TestSeededFileMoveExample_MovesRealFileIntoTemplatedDestination(t *testing.T) {
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
		if wf.Label == "Example: File inbox to folder" {
			seed = wf
		}
	}
	if seed.ID == "" {
		t.Fatal(`no built-in workflow labeled "Example: File inbox to folder"`)
	}

	// Point the seed's own graph at real directories instead of its
	// shipped placeholders -- editing the draft head only
	// (UpdateWorkflow), same as any real user pointing this workflow
	// somewhere real via the canvas Inspector.
	watchDir := t.TempDir()
	destRoot := t.TempDir()
	newNodes := make([]composition.Node, len(seed.Nodes))
	copy(newNodes, seed.Nodes)
	for i, n := range newNodes {
		cfg := make(map[string]string, len(n.Config))
		for k, v := range n.Config {
			cfg[k] = v
		}
		switch n.NodeTypeID {
		case "trigger-filesystem-watch":
			cfg["path"] = watchDir
		case "apply-file-move":
			cfg["destination"] = filepath.Join(destRoot, "{date:2006-01}", "{filename}")
		}
		newNodes[i].Config = cfg
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

	if err := os.WriteFile(filepath.Join(watchDir, "invoice.pdf"), []byte("hello"), 0o600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	deadline := time.Now().Add(10 * time.Second)
	var found bool
	for time.Now().Before(deadline) {
		runs, err := exec.ListRunsForWorkflow(seed.ID)
		if err == nil {
			for _, r := range triggeredRuns(runs) {
				if r.Status == "SUCCESS" {
					found = true
				}
			}
		}
		if found {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if !found {
		t.Fatal("no successful triggered run appeared for the re-pointed seed after creating a matching file in its watched directory")
	}

	want := filepath.Join(destRoot, time.Now().Format("2006-01"), "invoice.pdf")
	got, err := os.ReadFile(want) //nolint:gosec // t.TempDir()-scoped test fixture path, not user input
	if err != nil {
		t.Fatalf("the file did not land at the templated destination %s: %v", want, err)
	}
	if string(got) != "hello" {
		t.Errorf("moved file content = %q, want %q", got, "hello")
	}
}
