package main

import (
	"encoding/json"
	"log/slog"
	"testing"
)

// fakeStore is an in-memory settings.Store, so persist()/RestoreBindings()
// can be tested without a real file on disk. Assign/Unassign themselves go
// through the real OS hotkey API (internal/adapters/hotkey), which -- like
// the rest of HotkeyService -- can't be exercised in headless/CI
// environments (see docs/SPEC.md §1.3); these tests cover the persistence
// plumbing in isolation instead, by manipulating h.raw directly.
type fakeStore struct {
	data map[string]any
}

func newFakeStore() *fakeStore {
	return &fakeStore{data: make(map[string]any)}
}

func (f *fakeStore) Get(key string) any {
	return f.data[key]
}

func (f *fakeStore) Set(key string, value any) error {
	f.data[key] = value
	return nil
}

func TestPersist_WritesBindingsAsJSON(t *testing.T) {
	store := newFakeStore()
	h := NewHotkeyService(&RunbookService{}, slog.Default(), store)
	h.raw["load-sample-html"] = persistedBinding{Mods: []string{"cmd", "shift"}, Key: "K"}

	h.persist()

	raw, ok := store.data[hotkeyBindingsKey].(string)
	if !ok {
		t.Fatalf("store[%q] = %#v, want a JSON string", hotkeyBindingsKey, store.data[hotkeyBindingsKey])
	}

	var got map[string]persistedBinding
	if err := json.Unmarshal([]byte(raw), &got); err != nil {
		t.Fatalf("unmarshal persisted bindings: %v", err)
	}

	want := persistedBinding{Mods: []string{"cmd", "shift"}, Key: "K"}
	pb, ok := got["load-sample-html"]
	if !ok {
		t.Fatalf("persisted bindings = %+v, missing \"load-sample-html\"", got)
	}
	if pb.Key != want.Key || len(pb.Mods) != len(want.Mods) || pb.Mods[0] != want.Mods[0] || pb.Mods[1] != want.Mods[1] {
		t.Errorf("persisted binding = %+v, want %+v", pb, want)
	}
}

func TestPersist_EmptyRawWritesEmptyObject(t *testing.T) {
	store := newFakeStore()
	h := NewHotkeyService(&RunbookService{}, slog.Default(), store)

	h.persist()

	raw, ok := store.data[hotkeyBindingsKey].(string)
	if !ok {
		t.Fatalf("store[%q] = %#v, want a JSON string", hotkeyBindingsKey, store.data[hotkeyBindingsKey])
	}
	if raw != "{}" {
		t.Errorf("persist() with no bindings wrote %q, want \"{}\"", raw)
	}
}

func TestRestoreBindings_NoStoredData_IsANoOp(t *testing.T) {
	store := newFakeStore()
	h := NewHotkeyService(&RunbookService{}, slog.Default(), store)

	// Must not panic or block on a fresh install where the key was never set.
	h.RestoreBindings()

	if len(h.bindings) != 0 {
		t.Errorf("RestoreBindings() with no stored data registered %d bindings, want 0", len(h.bindings))
	}
}

func TestRestoreBindings_MalformedJSON_LogsAndReturns(t *testing.T) {
	store := newFakeStore()
	store.data[hotkeyBindingsKey] = "not valid json"
	h := NewHotkeyService(&RunbookService{}, slog.Default(), store)

	// Must not panic on a corrupt settings file.
	h.RestoreBindings()

	if len(h.bindings) != 0 {
		t.Errorf("RestoreBindings() with malformed JSON registered %d bindings, want 0", len(h.bindings))
	}
}
