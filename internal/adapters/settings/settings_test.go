package settings

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func TestNew_CreatesParentDirectory(t *testing.T) {
	dir := t.TempDir()
	filename := filepath.Join(dir, "nested", "settings.json")

	if _, err := New(filename); err != nil {
		t.Fatalf("New(%q) = %v, want nil error", filename, err)
	}
}

func TestSnapshotFreshStateAndPersistedDeletion(t *testing.T) {
	filename := filepath.Join(t.TempDir(), "settings.json")
	store, err := New(filename)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := store.Snapshot()
	if err != nil || string(raw) != "{}" {
		t.Fatalf("fresh Snapshot = %q, %v", raw, err)
	}
	if err := store.Set("key", "value"); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filename); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Snapshot(); err == nil {
		t.Fatal("Snapshot succeeded after persisted file was deleted")
	}
}

func TestSnapshotReturnsDetachedValidatedBytes(t *testing.T) {
	filename := filepath.Join(t.TempDir(), "settings.json")
	store, err := New(filename)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Set("key", "value"); err != nil {
		t.Fatal(err)
	}
	first, err := store.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	first[0] = 'x'
	second, err := store.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	var object map[string]any
	if err := json.Unmarshal(second, &object); err != nil || object["key"] != "value" {
		t.Fatalf("detached Snapshot = %q, %v", second, err)
	}
}

func TestSnapshotSerializesWithAutosave(t *testing.T) {
	filename := filepath.Join(t.TempDir(), "settings.json")
	store, err := New(filename)
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(2)
		go func(value int) {
			defer wg.Done()
			if err := store.Set("counter", value); err != nil {
				t.Errorf("Set: %v", err)
			}
		}(i)
		go func() {
			defer wg.Done()
			raw, err := store.Snapshot()
			if err != nil {
				t.Errorf("Snapshot: %v", err)
				return
			}
			var object map[string]any
			if err := json.Unmarshal(raw, &object); err != nil {
				t.Errorf("Snapshot returned partial JSON: %q: %v", raw, err)
			}
		}()
	}
	wg.Wait()
}

func TestNew_FreshInstall_HasNoData(t *testing.T) {
	filename := filepath.Join(t.TempDir(), "settings.json")

	store, err := New(filename)
	if err != nil {
		t.Fatalf("New(%q) = %v, want nil error", filename, err)
	}

	if got := store.Get("anything"); got != nil {
		t.Errorf("Get on a fresh store = %v, want nil", got)
	}
}

// The actual thing this package exists for: a value Set by one process
// (e.g. Mill's previous run) is visible to a fresh store instance pointed
// at the same file (e.g. Mill's next run) -- AutoSave writes on Set, and
// New's own Load reads back what's on disk. Real disk I/O, not mocked;
// HotkeyService's own tests fake this interface instead, since they're
// about HotkeyService's JSON shape, not about whether the file round-trips.
func TestSet_SurvivesAcrossStoreInstances(t *testing.T) {
	filename := filepath.Join(t.TempDir(), "settings.json")

	first, err := New(filename)
	if err != nil {
		t.Fatalf("New(%q) = %v, want nil error", filename, err)
	}
	if err := first.Set("hotkey-bindings", `{"load-sample-html":{"mods":["cmd"],"key":"K"}}`); err != nil {
		t.Fatalf("Set() = %v, want nil error", err)
	}

	second, err := New(filename)
	if err != nil {
		t.Fatalf("second New(%q) = %v, want nil error", filename, err)
	}
	got, ok := second.Get("hotkey-bindings").(string)
	if !ok {
		t.Fatalf("Get() after reload = %#v, want a string", second.Get("hotkey-bindings"))
	}
	want := `{"load-sample-html":{"mods":["cmd"],"key":"K"}}`
	if got != want {
		t.Errorf("Get() after reload = %q, want %q", got, want)
	}
}
