package triggersvc

import (
	"encoding/json"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// Real OS hotkey registration (internal/adapters/hotkey) can't be
// exercised in headless/CI environments (see docs/SPEC.md §1.3) --
// these tests cover the persistence plumbing and the conflict-rejection
// rule in isolation instead, by manipulating s.hkRaw directly and
// asserting AssignHotkey rejects a conflict *before* it ever reaches
// the real OS call. The in-memory settings.Store fake lives in
// internal/services/servicetest, shared across every service package's
// tests.

func TestPersistHotkeys_WritesBindingsAsJSON(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	s := NewTriggerService(comp, slog.Default(), store)
	s.hkRaw["load-sample-html-workflow"] = PersistedHotkey{Mods: []string{"cmd", "shift"}, Key: "K"}

	s.persistHotkeys()

	raw, ok := store.Get(HotkeyBindingsKey).(string)
	if !ok {
		t.Fatalf("store[%q] = %#v, want a JSON string", HotkeyBindingsKey, store.Get(HotkeyBindingsKey))
	}

	var got map[string]PersistedHotkey
	if err := json.Unmarshal([]byte(raw), &got); err != nil {
		t.Fatalf("unmarshal persisted bindings: %v", err)
	}

	want := PersistedHotkey{Mods: []string{"cmd", "shift"}, Key: "K"}
	pb, ok := got["load-sample-html-workflow"]
	if !ok {
		t.Fatalf("persisted bindings = %+v, missing \"load-sample-html-workflow\"", got)
	}
	if pb.Key != want.Key || len(pb.Mods) != len(want.Mods) || pb.Mods[0] != want.Mods[0] || pb.Mods[1] != want.Mods[1] {
		t.Errorf("persisted binding = %+v, want %+v", pb, want)
	}
}

func TestPersistHotkeys_EmptyRawWritesEmptyObject(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	s := NewTriggerService(comp, slog.Default(), store)

	s.persistHotkeys()

	raw, ok := store.Get(HotkeyBindingsKey).(string)
	if !ok {
		t.Fatalf("store[%q] = %#v, want a JSON string", HotkeyBindingsKey, store.Get(HotkeyBindingsKey))
	}
	if raw != "{}" {
		t.Errorf("persistHotkeys() with no bindings wrote %q, want \"{}\"", raw)
	}
}

func TestLoadPersistedHotkeys_NoStoredData_IsANoOp(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	s := NewTriggerService(comp, slog.Default(), store)

	if len(s.hkRaw) != 0 {
		t.Errorf("NewTriggerService() with no stored data loaded %d bindings, want 0", len(s.hkRaw))
	}
}

func TestLoadPersistedHotkeys_MalformedJSON_LogsAndReturns(t *testing.T) {
	store := servicetest.NewFakeStore()
	_ = store.Set(HotkeyBindingsKey, "not valid json")
	comp := compositionsvc.NewCompositionService(store)

	// Must not panic on a corrupt settings file.
	s := NewTriggerService(comp, slog.Default(), store)

	if len(s.hkRaw) != 0 {
		t.Errorf("NewTriggerService() with malformed JSON loaded %d bindings, want 0", len(s.hkRaw))
	}
}

func TestAssignHotkey_RejectsConflict(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	s := NewTriggerService(comp, slog.Default(), store)

	// Seeded directly (not via AssignHotkey, which would hit the real OS
	// hotkey API and can't run headless) -- CheckConflict runs before
	// AssignHotkey ever calls hotkey.Bind, so this exercises the
	// rejection path without touching real OS state.
	s.hkRaw["load-sample-html-workflow"] = PersistedHotkey{Mods: []string{"cmd", "shift"}, Key: "M"}

	_, err := s.AssignHotkey("clipboard-html-to-markdown-workflow", []string{"cmd", "shift"}, "M")
	if err == nil {
		t.Fatal("AssignHotkey() with a combo already claimed by another workflow: want error, got nil")
	}
	if !strings.Contains(err.Error(), "Load sample HTML") {
		t.Errorf("AssignHotkey() error = %q, want it to name the conflicting workflow", err.Error())
	}
}

func TestAssignHotkey_RequiresAtLeastOneModifier(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	s := NewTriggerService(comp, slog.Default(), store)

	if _, err := s.AssignHotkey("some-workflow", nil, "M"); err == nil {
		t.Fatal("AssignHotkey() with no modifiers: want error, got nil")
	}
}

// ArmedWorkflows backs docs/goals/0006-trigger-aware-workflows-list.md's
// tri-state armed label -- it has to reflect Sync's real gate
// (!Disabled && PublishedVersion > 0), not a re-derivation of it, so
// this exercises Sync itself (not s.active directly) the same way a
// real Create/Update/Publish/Disable call would trigger it. Uses
// trigger-clipboard-watch as the fixture trigger type since its
// starter (triggerclipboardwatch.go) needs no Config to arm --
// isolates the published/disabled gate from a second, unrelated
// "is this trigger configured" variable trigger-schedule/
// trigger-filesystem-watch would introduce.
func TestArmedWorkflows_ReflectsSyncsPublishedAndDisabledGate(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	s := NewTriggerService(comp, slog.Default(), store)
	t.Cleanup(func() { s.Sync(nil) }) // stop every listener this test starts

	clipboardTrigger := []composition.Node{
		{ID: "n1", Kind: composition.KindTrigger, NodeTypeID: "trigger-clipboard-watch"},
	}

	armedWF := composition.PublishHead(composition.Workflow{
		ID: "wf-armed", Label: "Armed clipboard watch", Nodes: clipboardTrigger,
	}, time.Now())

	unpublishedWF := composition.Workflow{
		ID: "wf-unpublished", Label: "Never published clipboard watch", Nodes: clipboardTrigger,
	}

	disabledWF := composition.PublishHead(composition.Workflow{
		ID: "wf-disabled", Label: "Disabled clipboard watch", Nodes: clipboardTrigger, Disabled: true,
	}, time.Now())

	s.Sync([]composition.Workflow{armedWF, unpublishedWF, disabledWF})

	armed := s.ArmedWorkflows()
	if !armed["wf-armed"] {
		t.Errorf("ArmedWorkflows() = %v, want \"wf-armed\" present (published, enabled)", armed)
	}
	if armed["wf-unpublished"] {
		t.Errorf("ArmedWorkflows() = %v, want \"wf-unpublished\" absent (never published)", armed)
	}
	if armed["wf-disabled"] {
		t.Errorf("ArmedWorkflows() = %v, want \"wf-disabled\" absent (disabled)", armed)
	}
	if len(armed) != 1 {
		t.Errorf("ArmedWorkflows() = %v, want exactly 1 entry", armed)
	}
}
