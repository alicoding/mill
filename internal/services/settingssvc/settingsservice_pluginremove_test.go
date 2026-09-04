package settingssvc

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

// installedFolder makes a plugin-shaped folder on disk to remove.
func installedFolder(t *testing.T, name string) string {
	t.Helper()
	dir := filepath.Join(t.TempDir(), name)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), []byte(`{"id":"`+name+`"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	return dir
}

// TestRemovePlugin_UnwiredReportsUnavailable pins the fail-closed
// default: a build with no plugin service never removes anything.
func TestRemovePlugin_UnwiredReportsUnavailable(t *testing.T) {
	set := newExtensionsHarness(t)
	if _, err := set.RemovePlugin("mill-a"); !errors.Is(err, errRemovalUnavailable) {
		t.Fatalf("err = %v, want errRemovalUnavailable", err)
	}
}

// TestRemovePlugin_TrashesTheFolderAndWithdrawsConsent is the whole
// contract: the folder leaves its install path, the reported
// destination exists, and the plugin is no longer allowed to run --
// so copying it back in later asks for consent again.
func TestRemovePlugin_TrashesTheFolderAndWithdrawsConsent(t *testing.T) {
	set := newExtensionsHarness(t)
	dir := installedFolder(t, "mill-a")
	set.WirePluginRemoval(func(id string) (string, bool, bool) {
		if id != "mill-a" {
			return "", false, false
		}
		return dir, false, true
	})
	if err := set.SetPluginAllowed("mill-a", true); err != nil {
		t.Fatal(err)
	}

	dest, err := set.RemovePlugin("mill-a")
	if err != nil {
		t.Fatalf("RemovePlugin: %v", err)
	}
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Errorf("the folder is still installed (stat err = %v)", err)
	}
	if _, err := os.Stat(dest); err != nil {
		t.Errorf("reported destination %q is not there: %v", dest, err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dest) })
	if got := set.GetAllowedPlugins(); len(got) != 0 {
		t.Errorf("allowed = %v, want empty -- removal withdraws consent", got)
	}
}

// TestRemovePlugin_RefusesUnknownAndBuiltIn pins the two refusals: an
// id nothing installed answers to, and one of Mill's own bundled
// plugins, which lives inside the app bundle.
func TestRemovePlugin_RefusesUnknownAndBuiltIn(t *testing.T) {
	set := newExtensionsHarness(t)
	dir := installedFolder(t, "mill-drawing")
	set.WirePluginRemoval(func(id string) (string, bool, bool) {
		if id != "mill-drawing" {
			return "", false, false
		}
		return dir, true, true
	})

	if _, err := set.RemovePlugin("nobody"); !errors.Is(err, errPluginNotInstalled) {
		t.Errorf("unknown id err = %v, want errPluginNotInstalled", err)
	}
	if _, err := set.RemovePlugin("mill-drawing"); !errors.Is(err, errPluginBuiltIn) {
		t.Errorf("built-in err = %v, want errPluginBuiltIn", err)
	}
	if _, err := os.Stat(dir); err != nil {
		t.Errorf("a refused removal must leave the folder alone: %v", err)
	}
}
