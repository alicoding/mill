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

// newFileWatchTestServices spins up the same cross-service stack
// TestSeededDisabledFilesystemWatch_FiresRealWorkflowOnFileCreate uses
// (filesystemwatch_seed_test.go), factored out since both cycle-guard
// tests below need it twice over (two independently watched folders).
func newFileWatchTestServices(t *testing.T) (*compositionsvc.CompositionService, *TriggerService, *executionsvc.ExecutionService) {
	t.Helper()
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
	return comp, s, exec
}

// TestFileWatchCycleGuard_MoveIntoOwnWatchedFolder_DoesNotReFire is the
// goal's structural proof: a workflow watches dir D, and its own
// apply-file-move step renames the fired file to another name INSIDE
// D -- a move fsnotify itself reports as a second change to D. Without
// the guard (filewriteguard.go), that second event would re-fire the
// SAME workflow on its own write, which would move the file again,
// forever. With the guard, exactly one triggered run appears.
func TestFileWatchCycleGuard_MoveIntoOwnWatchedFolder_DoesNotReFire(t *testing.T) {
	comp, s, exec := newFileWatchTestServices(t)

	watchDir := t.TempDir()
	dest := filepath.Join(watchDir, "moved.txt")
	const (
		triggerID = "cycle-guard-trigger"
		moveID    = "cycle-guard-move"
	)
	nodes, err := composition.ResolveNodeDefaults([]composition.Node{
		{ID: triggerID, NodeTypeID: "trigger-filesystem-watch", Config: map[string]string{"path": watchDir}},
		{ID: moveID, NodeTypeID: "apply-file-move", Config: map[string]string{"destination": dest, "onConflict": "suffix"}},
	})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults: %v", err)
	}
	wf, err := comp.CreateWorkflow("Cycle guard: move within watched folder", "", nodes,
		[]composition.Edge{{ID: "cycle-guard-e0", Source: triggerID, Target: moveID}})
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}
	if _, err := comp.PublishWorkflow(wf.ID); err != nil {
		t.Fatalf("PublishWorkflow: %v", err)
	}
	if !s.ArmedWorkflows()[wf.ID] {
		t.Fatal("the published workflow is not armed, want ArmedWorkflows() to report it live")
	}

	if err := os.WriteFile(filepath.Join(watchDir, "incoming.txt"), []byte("hello"), 0o600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		runs, err := exec.ListRunsForWorkflow(wf.ID)
		if err == nil && len(triggeredRuns(runs)) > 0 {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	// Give a would-be (incorrect) second fire time to also land before
	// counting -- the guard's own TTL is 10s, so a loop bug would
	// produce its second run well within this window.
	time.Sleep(500 * time.Millisecond)

	runs, err := exec.ListRunsForWorkflow(wf.ID)
	if err != nil {
		t.Fatalf("ListRunsForWorkflow: %v", err)
	}
	triggered := triggeredRuns(runs)
	if len(triggered) != 1 {
		t.Fatalf("cycle guard failed: %d triggered runs, want exactly 1 (%+v)", len(triggered), triggered)
	}
	if triggered[0].Status != "SUCCESS" {
		t.Fatalf("triggered run status = %q (error %q), want SUCCESS", triggered[0].Status, triggered[0].Error)
	}
	if _, err := os.Stat(dest); err != nil {
		t.Errorf("os.Stat(dest) = %v, want the file to have landed at %s", err, dest)
	}
}

// TestFileWatchCycleGuard_DifferentWorkflowWatchingSameFolder_StillFires
// is the guard's other half: workflow A watches folder X and moves
// whatever arrives into folder Y; workflow B independently watches
// folder Y. A's own write must not suppress B -- the guard is keyed by
// (path, workflow), not by path alone, so pipeline chaining between two
// independently authored workflows keeps working.
func TestFileWatchCycleGuard_DifferentWorkflowWatchingSameFolder_StillFires(t *testing.T) {
	comp, s, exec := newFileWatchTestServices(t)

	dirX, dirY := t.TempDir(), t.TempDir()

	const (
		aTriggerID = "chain-a-trigger"
		aMoveID    = "chain-a-move"
	)
	aNodes, err := composition.ResolveNodeDefaults([]composition.Node{
		{ID: aTriggerID, NodeTypeID: "trigger-filesystem-watch", Config: map[string]string{"path": dirX}},
		{ID: aMoveID, NodeTypeID: "apply-file-move", Config: map[string]string{"destination": dirY + "/"}},
	})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults (A): %v", err)
	}
	wfA, err := comp.CreateWorkflow("Chain: A moves into Y", "", aNodes,
		[]composition.Edge{{ID: "chain-a-e0", Source: aTriggerID, Target: aMoveID}})
	if err != nil {
		t.Fatalf("CreateWorkflow (A): %v", err)
	}

	const (
		bTriggerID = "chain-b-trigger"
		bInjectID  = "chain-b-inject"
	)
	bNodes, err := composition.ResolveNodeDefaults([]composition.Node{
		{ID: bTriggerID, NodeTypeID: "trigger-filesystem-watch", Config: map[string]string{"path": dirY}},
		{ID: bInjectID, NodeTypeID: "process-inject-text", Config: map[string]string{"text": "workflow B fired", "placement": "append"}},
	})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults (B): %v", err)
	}
	wfB, err := comp.CreateWorkflow("Chain: B watches Y", "", bNodes,
		[]composition.Edge{{ID: "chain-b-e0", Source: bTriggerID, Target: bInjectID}})
	if err != nil {
		t.Fatalf("CreateWorkflow (B): %v", err)
	}

	if _, err := comp.PublishWorkflow(wfA.ID); err != nil {
		t.Fatalf("PublishWorkflow (A): %v", err)
	}
	if _, err := comp.PublishWorkflow(wfB.ID); err != nil {
		t.Fatalf("PublishWorkflow (B): %v", err)
	}
	if !s.ArmedWorkflows()[wfA.ID] || !s.ArmedWorkflows()[wfB.ID] {
		t.Fatal("both published workflows should be armed")
	}

	if err := os.WriteFile(filepath.Join(dirX, "incoming.txt"), []byte("hello"), 0o600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		runs, err := exec.ListRunsForWorkflow(wfB.ID)
		if err == nil && len(triggeredRuns(runs)) > 0 {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}

	runs, err := exec.ListRunsForWorkflow(wfB.ID)
	if err != nil {
		t.Fatalf("ListRunsForWorkflow (B): %v", err)
	}
	triggered := triggeredRuns(runs)
	if len(triggered) == 0 {
		t.Fatal("workflow B never fired -- a different workflow watching the same folder A wrote into must still fire")
	}
	if triggered[0].Status != "SUCCESS" {
		t.Fatalf("B's triggered run status = %q (error %q), want SUCCESS", triggered[0].Status, triggered[0].Error)
	}
}
