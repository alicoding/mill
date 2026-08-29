package triggersvc

import (
	"log/slog"
	"testing"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// Regression (docs/goals/0250, composition-state): deleting a workflow
// left its hotkey binding in settings, so a later assign of the same
// combo was refused naming the dead workflow's raw id. The wired
// delete hook must release the binding and free the combo.
func TestDeleteWorkflow_ReleasesHotkeyBinding(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	s := NewTriggerService(comp, slog.Default(), store)
	comp.SetWorkflowDeleted(s.UnassignHotkey)

	wf, err := comp.CreateWorkflow("Doomed", "", []composition.Node{{ID: "t", NodeTypeID: "trigger-manual"}}, nil)
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}
	if _, err := s.DebugAssignHotkey(wf.ID, []string{"cmd", "shift"}, "K"); err != nil {
		t.Fatalf("DebugAssignHotkey: %v", err)
	}

	if err := comp.DeleteWorkflow(wf.ID); err != nil {
		t.Fatalf("DeleteWorkflow: %v", err)
	}
	if _, still := s.ListHotkeys()[wf.ID]; still {
		t.Fatal("deleted workflow's hotkey binding survived the delete")
	}

	// The combo is genuinely free again: another workflow can take it.
	if _, err := s.finalizeHotkeyAssignment("survivor", []string{"cmd", "shift"}, "K"); err != nil {
		t.Fatalf("reassigning the freed combo: %v", err)
	}
}

// PruneOrphanedHotkeys drops bindings whose workflow no longer exists
// (the boot heal for state leaked before the delete hook existed),
// keeps live ones, and never persists when nothing is orphaned.
func TestPruneOrphanedHotkeys(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	s := NewTriggerService(comp, slog.Default(), store)

	if _, err := s.DebugAssignHotkey("ghost-workflow", []string{"cmd"}, "G"); err != nil {
		t.Fatalf("DebugAssignHotkey ghost: %v", err)
	}
	if _, err := s.DebugAssignHotkey("live-workflow", []string{"cmd"}, "L"); err != nil {
		t.Fatalf("DebugAssignHotkey live: %v", err)
	}

	s.PruneOrphanedHotkeys([]string{"live-workflow"})

	got := s.ListHotkeys()
	if _, ghost := got["ghost-workflow"]; ghost {
		t.Fatal("orphaned binding survived the prune")
	}
	if _, live := got["live-workflow"]; !live {
		t.Fatal("live binding was wrongly pruned")
	}
}

func TestPruneOrphanedHotkeys_NoOrphansIsANoOp(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	s := NewTriggerService(comp, slog.Default(), store)

	// Nothing bound, nothing orphaned -- the prune must not write the
	// bindings key at all (no gratuitous persist on every boot).
	s.PruneOrphanedHotkeys([]string{"whatever"})
	if store.Get(HotkeyBindingsKey) != nil {
		t.Fatalf("no-op prune persisted: store[%q] = %#v", HotkeyBindingsKey, store.Get(HotkeyBindingsKey))
	}
}
