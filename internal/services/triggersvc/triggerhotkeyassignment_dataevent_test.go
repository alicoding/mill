package triggersvc

import (
	"log/slog"
	"testing"

	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// captureEmits mirrors compositionservice_dataevent_test.go's own helper
// (same seam, same restore-on-cleanup discipline) -- kept as a local
// copy rather than a shared helper since a helper used by only one
// package stays in that package (.claude/rules/backend.md).
func captureEmits(t *testing.T) *[]dataevent.Changed {
	t.Helper()
	var got []dataevent.Changed
	dataevent.TestHook = func(entity, id string) {
		got = append(got, dataevent.Changed{Entity: entity, ID: id})
	}
	t.Cleanup(func() { dataevent.TestHook = nil })
	return &got
}

func assertEmittedHotkey(t *testing.T, got []dataevent.Changed, workflowID string) {
	t.Helper()
	for _, c := range got {
		if c.Entity == "hotkey" && c.ID == workflowID {
			return
		}
	}
	t.Errorf("dataevent.Emit(\"hotkey\", %q) was not observed; got %+v", workflowID, got)
}

// Regression: no entity string existed for a hotkey assignment, so
// CommandPalette/QuickPanel/hotkeyCapture's cached combos went stale
// until a reload once a binding changed elsewhere. DebugAssignHotkey
// and UnassignHotkey are the two mutators this package can exercise
// fully headless (real hotkey.Bind can't run outside a native run
// loop -- see this file's sibling triggerservice_test.go's own header
// comment); AssignHotkey shares the same finalizeHotkeyAssignment write
// + emit these two paths through, so covering them covers the emit
// call site AssignHotkey also reaches.
func TestDebugAssignHotkey_EmitsHotkeyDataEvent(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	s := NewTriggerService(comp, slog.Default(), store)

	got := captureEmits(t)
	if _, err := s.DebugAssignHotkey("some-workflow", []string{"cmd", "shift"}, "M"); err != nil {
		t.Fatalf("DebugAssignHotkey: %v", err)
	}
	assertEmittedHotkey(t, *got, "some-workflow")
}

func TestUnassignHotkey_EmitsHotkeyDataEvent(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	s := NewTriggerService(comp, slog.Default(), store)
	s.hkRaw["some-workflow"] = PersistedHotkey{Mods: []string{"cmd", "shift"}, Key: "M"}

	got := captureEmits(t)
	s.UnassignHotkey("some-workflow")
	assertEmittedHotkey(t, *got, "some-workflow")
}

// UnassignHotkey on a workflow with no binding is a no-op -- must not
// emit, since nothing actually changed.
func TestUnassignHotkey_NoExistingBinding_DoesNotEmit(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	s := NewTriggerService(comp, slog.Default(), store)

	got := captureEmits(t)
	s.UnassignHotkey("no-such-workflow")
	if len(*got) != 0 {
		t.Errorf("UnassignHotkey() on a workflow with no binding emitted %+v, want no emits", *got)
	}
}
