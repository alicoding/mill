package settings

import (
	"path/filepath"
	"testing"
)

func TestNew_CreatesParentDirectory(t *testing.T) {
	dir := t.TempDir()
	filename := filepath.Join(dir, "nested", "settings.json")

	if _, err := New(filename); err != nil {
		t.Fatalf("New(%q) = %v, want nil error", filename, err)
	}
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
