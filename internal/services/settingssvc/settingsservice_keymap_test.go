package settingssvc

import (
	"errors"
	"log/slog"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
	"github.com/alicoding/mill/internal/services/triggersvc"
)

// errFakeSettingsPersist is the injected failure servicetest.FakeStore.
// SetErr returns for the persist-failure tests below (docs/goals/0025
// items 1/2).
var errFakeSettingsPersist = errors.New("fake persist failure")

// Same "seed state directly, assert rejection happens before any real
// OS call" discipline as settingsservice_test.go's summon-hotkey tests
// -- SetKeybinding never touches a real OS hotkey (docs/goals/0016's
// keymap commands are in-window only, App.tsx's own keydown listener),
// so these are all headless-testable.

func TestSetKeybinding_RoundTrips(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	trig := triggersvc.NewTriggerService(comp, slog.Default(), store)
	set := NewSettingsService(store, trig, false)

	label, err := set.SetKeybinding("workflow.save", []string{"cmd", "shift"}, "S")
	if err != nil {
		t.Fatalf("SetKeybinding() error = %v, want nil", err)
	}
	if label == "" {
		t.Error("SetKeybinding() returned an empty label")
	}

	got := set.ListKeybindings()
	hk, ok := got["workflow.save"]
	if !ok {
		t.Fatal("ListKeybindings() has no entry for workflow.save after SetKeybinding")
	}
	if len(hk.Mods) != 2 || hk.Mods[0] != "cmd" || hk.Mods[1] != "shift" || hk.Key != "S" {
		t.Errorf("ListKeybindings()[workflow.save] = %+v, want {Mods:[cmd shift] Key:S}", hk)
	}
}

func TestSetKeybinding_RejectsAnotherCommandsOverride(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	trig := triggersvc.NewTriggerService(comp, slog.Default(), store)
	set := NewSettingsService(store, trig, false)

	if _, err := set.SetKeybinding("tab.close", []string{"cmd"}, "W"); err != nil {
		t.Fatalf("first SetKeybinding() error = %v, want nil", err)
	}

	_, err := set.SetKeybinding("workflow.new", []string{"cmd"}, "W")
	if err == nil {
		t.Fatal("SetKeybinding() with a combo already overridden by another command: want error, got nil")
	}
	if !strings.Contains(err.Error(), "tab.close") {
		t.Errorf("SetKeybinding() error = %q, want it to name the conflicting command", err.Error())
	}
}

func TestSetKeybinding_ReassigningTheSameCommandIsNotASelfConflict(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	trig := triggersvc.NewTriggerService(comp, slog.Default(), store)
	set := NewSettingsService(store, trig, false)

	if _, err := set.SetKeybinding("workflow.save", []string{"cmd"}, "S"); err != nil {
		t.Fatalf("first SetKeybinding() error = %v, want nil", err)
	}
	// Rebinding workflow.save to a NEW combo must not trip over its own
	// previous override -- CheckConflict's excludeWorkflowID param
	// (reused here as excludeCommandID) is what makes this safe.
	if _, err := set.SetKeybinding("workflow.save", []string{"cmd", "shift"}, "S"); err != nil {
		t.Fatalf("re-SetKeybinding() on the same command error = %v, want nil", err)
	}
}

func TestSetKeybinding_RejectsWorkflowTriggerConflict(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)

	// Seeded via the persisted-bindings store key, same pattern
	// TestAssignSummonHotkey_RejectsWorkflowConflict uses -- SetKeybinding
	// checks trig.ClaimedCombos() before persisting anything.
	_ = store.Set(triggersvc.HotkeyBindingsKey, `{"load-sample-html-workflow":{"mods":["cmd","shift"],"key":"M"}}`)
	trig := triggersvc.NewTriggerService(comp, slog.Default(), store)
	set := NewSettingsService(store, trig, false)

	_, err := set.SetKeybinding("workflow.save", []string{"cmd", "shift"}, "M")
	if err == nil {
		t.Fatal("SetKeybinding() with a combo already claimed by a workflow: want error, got nil")
	}
	if !strings.Contains(err.Error(), "Load sample HTML") {
		t.Errorf("SetKeybinding() error = %q, want it to name the conflicting workflow", err.Error())
	}
}

func TestSetKeybinding_RejectsEmptyMods(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	trig := triggersvc.NewTriggerService(comp, slog.Default(), store)
	set := NewSettingsService(store, trig, false)

	if _, err := set.SetKeybinding("tab.close", nil, "W"); err == nil {
		t.Fatal("SetKeybinding() with no modifiers: want error, got nil")
	}
}

func TestClearKeybinding_RemovesOverride(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	trig := triggersvc.NewTriggerService(comp, slog.Default(), store)
	set := NewSettingsService(store, trig, false)

	if _, err := set.SetKeybinding("workflow.new", []string{"cmd", "shift"}, "N"); err != nil {
		t.Fatalf("SetKeybinding() error = %v, want nil", err)
	}
	if err := set.ClearKeybinding("workflow.new"); err != nil {
		t.Fatalf("ClearKeybinding() error = %v, want nil", err)
	}

	if _, ok := set.ListKeybindings()["workflow.new"]; ok {
		t.Error("ListKeybindings() still has workflow.new after ClearKeybinding()")
	}
}

func TestClearKeybinding_UnknownCommand_DoesNotPanic(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	trig := triggersvc.NewTriggerService(comp, slog.Default(), store)
	set := NewSettingsService(store, trig, false)

	if err := set.ClearKeybinding("does.not.exist"); err != nil {
		t.Fatalf("ClearKeybinding() on an unknown command error = %v, want nil", err)
	}
}

func TestListKeybindings_EmptyWhenNothingOverridden(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	trig := triggersvc.NewTriggerService(comp, slog.Default(), store)
	set := NewSettingsService(store, trig, false)

	if got := set.ListKeybindings(); len(got) != 0 {
		t.Errorf("ListKeybindings() on a fresh service = %v, want empty", got)
	}
}

func TestKeymap_PersistsAndReloads(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	trig := triggersvc.NewTriggerService(comp, slog.Default(), store)
	set := NewSettingsService(store, trig, false)

	if _, err := set.SetKeybinding("workflow.run", []string{"cmd"}, "R"); err != nil {
		t.Fatalf("SetKeybinding() error = %v, want nil", err)
	}

	// A real persist/restore round trip over the same store, not just an
	// in-memory read of what was just written -- same discipline
	// TestSettingsService_PersistAndLoadSummonHotkey already uses.
	reloaded := NewSettingsService(store, trig, false)
	hk, ok := reloaded.ListKeybindings()["workflow.run"]
	if !ok {
		t.Fatal("ListKeybindings() on a reloaded service has no entry for workflow.run")
	}
	if len(hk.Mods) != 1 || hk.Mods[0] != "cmd" || hk.Key != "R" {
		t.Errorf("reloaded ListKeybindings()[workflow.run] = %+v, want {Mods:[cmd] Key:R}", hk)
	}
}

// docs/goals/0025 items 1/2, the settingssvc keymap path specifically
// named in the audit: SetKeybinding/ClearKeybinding used to swallow
// persistKeymap's error, leaving a phantom-saved (Set) or
// non-rolled-back (Clear) override in memory whenever the store write
// actually failed -- servicetest.FakeStore.SetErr makes this
// reproducible for the first time.

func TestSetKeybinding_PersistFailure_ReturnsErrorAndDoesNotPhantomSave(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	trig := triggersvc.NewTriggerService(comp, slog.Default(), store)
	set := NewSettingsService(store, trig, false)

	store.SetErr = errFakeSettingsPersist
	if _, err := set.SetKeybinding("workflow.save", []string{"cmd", "shift"}, "S"); err == nil {
		t.Fatal("SetKeybinding() with a failing store: want error, got nil")
	}

	store.SetErr = nil
	if got := set.ListKeybindings(); len(got) != 0 {
		t.Errorf("ListKeybindings() after a failed SetKeybinding = %v, want empty (no phantom-saved override)", got)
	}
}

func TestClearKeybinding_PersistFailure_ReturnsErrorAndRestoresOverride(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	trig := triggersvc.NewTriggerService(comp, slog.Default(), store)
	set := NewSettingsService(store, trig, false)

	if _, err := set.SetKeybinding("workflow.save", []string{"cmd", "shift"}, "S"); err != nil {
		t.Fatalf("SetKeybinding() error = %v, want nil", err)
	}

	store.SetErr = errFakeSettingsPersist
	if err := set.ClearKeybinding("workflow.save"); err == nil {
		t.Fatal("ClearKeybinding() with a failing store: want error, got nil")
	}

	store.SetErr = nil
	if _, ok := set.ListKeybindings()["workflow.save"]; !ok {
		t.Error("ListKeybindings() lost the workflow.save override after a failed ClearKeybinding -- the removal was not rolled back")
	}
}
