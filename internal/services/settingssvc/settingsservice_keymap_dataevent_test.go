package settingssvc

import (
	"log/slog"
	"testing"

	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/servicetest"
	"github.com/alicoding/mill/internal/services/triggersvc"
)

// captureEmits mirrors compositionservice_dataevent_test.go's own helper
// -- kept local rather than shared since only this package's dataevent
// tests use it (.claude/rules/backend.md's one-caller-stays-local rule).
func captureEmits(t *testing.T) *[]dataevent.Changed {
	t.Helper()
	var got []dataevent.Changed
	dataevent.TestHook = func(entity, id string) {
		got = append(got, dataevent.Changed{Entity: entity, ID: id})
	}
	t.Cleanup(func() { dataevent.TestHook = nil })
	return &got
}

func assertEmittedKeybinding(t *testing.T, got []dataevent.Changed, commandID string) {
	t.Helper()
	for _, c := range got {
		if c.Entity == "keybinding" && c.ID == commandID {
			return
		}
	}
	t.Errorf("dataevent.Emit(\"keybinding\", %q) was not observed; got %+v", commandID, got)
}

// Regression: no entity string existed for a command-keybinding
// override, so views/KeyboardShortcutsSection.tsx's own recorder (via
// composition/hotkeyCapture.ts's useCommandKeybindingCapture) never
// reflected a rebind made in another surface without a reload.
func TestSetKeybinding_EmitsKeybindingDataEvent(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	trig := triggersvc.NewTriggerService(comp, slog.Default(), store)
	set := NewSettingsService(store, trig, false)

	got := captureEmits(t)
	if _, err := set.SetKeybinding("workflow.save", []string{"cmd", "shift"}, "S"); err != nil {
		t.Fatalf("SetKeybinding: %v", err)
	}
	assertEmittedKeybinding(t, *got, "workflow.save")
}

func TestClearKeybinding_EmitsKeybindingDataEvent(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	trig := triggersvc.NewTriggerService(comp, slog.Default(), store)
	set := NewSettingsService(store, trig, false)
	if _, err := set.SetKeybinding("workflow.save", []string{"cmd", "shift"}, "S"); err != nil {
		t.Fatalf("SetKeybinding: %v", err)
	}

	got := captureEmits(t)
	if err := set.ClearKeybinding("workflow.save"); err != nil {
		t.Fatalf("ClearKeybinding: %v", err)
	}
	assertEmittedKeybinding(t, *got, "workflow.save")
}

// A failed persist must not emit -- nothing actually changed from the
// frontend's point of view (SetKeybinding/ClearKeybinding both restore
// prior in-memory state on a persist failure, see
// settingsservice_keymap_test.go's own persist-failure tests).
func TestSetKeybinding_PersistFailure_DoesNotEmit(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	trig := triggersvc.NewTriggerService(comp, slog.Default(), store)
	set := NewSettingsService(store, trig, false)

	store.SetErr = errFakeSettingsPersist
	got := captureEmits(t)
	if _, err := set.SetKeybinding("workflow.save", []string{"cmd", "shift"}, "S"); err == nil {
		t.Fatal("SetKeybinding() with a failing store: want error, got nil")
	}
	store.SetErr = nil
	if len(*got) != 0 {
		t.Errorf("SetKeybinding() with a failing persist emitted %+v, want no emits", *got)
	}
}
