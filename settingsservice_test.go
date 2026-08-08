package main

import (
	"log/slog"
	"strings"
	"testing"
)

// Both directions of docs/SPEC.md §3.7's bidirectional hotkey-conflict
// check, exercised via the same "seed state directly, assert rejection
// happens before any real OS hotkey.Bind call" pattern
// TestAssignHotkey_RejectsConflict (triggerservice_test.go) already
// established -- these can't call the real hotkey API headless either.

func TestAssignHotkey_RejectsSummonHotkeyConflict(t *testing.T) {
	store := newFakeStore()
	comp := NewCompositionService(store)
	trig := NewTriggerService(comp, slog.Default(), store)
	set := NewSettingsService(store, trig)

	// Seeded directly, not via AssignSummonHotkey (real OS call) --
	// ReservedCombo only reads s.summonHK, so this exercises the
	// rejection path in TriggerService.AssignHotkey without touching
	// real OS state.
	set.summonHK = persistedHotkey{Mods: []string{"option", "shift"}, Key: "Space"}
	trig.SetReservedCombo(set.ReservedCombo)

	_, err := trig.AssignHotkey("some-workflow", []string{"option", "shift"}, "Space")
	if err == nil {
		t.Fatal("AssignHotkey() with a combo already claimed by the summon hotkey: want error, got nil")
	}
	if !strings.Contains(err.Error(), "summon") {
		t.Errorf("AssignHotkey() error = %q, want it to mention the summon hotkey", err.Error())
	}
}

func TestAssignSummonHotkey_RejectsWorkflowConflict(t *testing.T) {
	store := newFakeStore()
	comp := NewCompositionService(store)
	trig := NewTriggerService(comp, slog.Default(), store)
	set := NewSettingsService(store, trig)

	// Seeded directly, not via AssignHotkey (real OS call) --
	// AssignSummonHotkey checks trig.ClaimedCombos() before ever
	// calling hotkey.Bind.
	trig.hkRaw["load-sample-html-workflow"] = persistedHotkey{Mods: []string{"cmd", "shift"}, Key: "M"}

	_, err := set.AssignSummonHotkey([]string{"cmd", "shift"}, "M")
	if err == nil {
		t.Fatal("AssignSummonHotkey() with a combo already claimed by a workflow: want error, got nil")
	}
	if !strings.Contains(err.Error(), "Load sample HTML") {
		t.Errorf("AssignSummonHotkey() error = %q, want it to name the conflicting workflow", err.Error())
	}
}

func TestSettingsService_GetSummonHotkey_EmptyWhenUnassigned(t *testing.T) {
	store := newFakeStore()
	comp := NewCompositionService(store)
	trig := NewTriggerService(comp, slog.Default(), store)
	set := NewSettingsService(store, trig)

	if got := set.GetSummonHotkey(); got != "" {
		t.Errorf("GetSummonHotkey() on a fresh service = %q, want empty", got)
	}
}

func TestSettingsService_PersistAndLoadSummonHotkey(t *testing.T) {
	store := newFakeStore()
	comp := NewCompositionService(store)
	trig := NewTriggerService(comp, slog.Default(), store)
	set := NewSettingsService(store, trig)

	set.summonHK = persistedHotkey{Mods: []string{"option", "shift"}, Key: "Space"}
	set.persistSummonHotkey()

	reloaded := NewSettingsService(store, trig)
	if got := reloaded.GetSummonHotkey(); got == "" {
		t.Error("GetSummonHotkey() on a service constructed against a store with a persisted summon hotkey: want a non-empty binding, got empty")
	}
}
