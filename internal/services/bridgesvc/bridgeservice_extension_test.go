package bridgesvc_test

import (
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"testing/fstest"

	"github.com/alicoding/mill/internal/services/bridgesvc"
)

// bundle stands in for the embedded extension: a manifest, a script,
// and a file one directory down, so the copy is proven to recurse.
func bundle() fs.FS {
	return fstest.MapFS{
		"manifest.json":     &fstest.MapFile{Data: []byte(`{"name":"Mill"}`)},
		"background.js":     &fstest.MapFile{Data: []byte("// background")},
		"icons/mill-16.png": &fstest.MapFile{Data: []byte("png")},
	}
}

func TestExtensionFolder_WritesEveryBundledFile(t *testing.T) {
	svc := bridgesvc.New(&stubAuth{token: "good"}, slog.New(slog.DiscardHandler))
	parent := t.TempDir()
	svc.SetExtensionBundle(bundle(), parent)

	dir, err := svc.ExtensionFolder()
	if err != nil {
		t.Fatalf("ExtensionFolder: %v", err)
	}
	if dir != filepath.Join(parent, "browser-extension") {
		t.Errorf("ExtensionFolder() = %q, want the browser-extension folder beside the settings file", dir)
	}
	for _, name := range []string{"manifest.json", "background.js", filepath.Join("icons", "mill-16.png")} {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			t.Errorf("%s was not written: %v", name, err)
		}
	}
}

// A Mill upgrade must not leave a stale extension loaded in someone's
// browser, so the folder is rewritten rather than left as found.
func TestExtensionFolder_RewritesWhatItAlreadyWrote(t *testing.T) {
	svc := bridgesvc.New(&stubAuth{token: "good"}, slog.New(slog.DiscardHandler))
	svc.SetExtensionBundle(bundle(), t.TempDir())
	dir, err := svc.ExtensionFolder()
	if err != nil {
		t.Fatalf("ExtensionFolder: %v", err)
	}
	manifest := filepath.Join(dir, "manifest.json")
	if err := os.WriteFile(manifest, []byte("stale"), 0o600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	if _, err := svc.ExtensionFolder(); err != nil {
		t.Fatalf("ExtensionFolder (second call): %v", err)
	}
	body, err := os.ReadFile(manifest) // #nosec G304 -- a path this test itself built under t.TempDir()
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	if string(body) != `{"name":"Mill"}` {
		t.Errorf("manifest.json = %q, want the bundled copy back", body)
	}
}

// A build wired without an extension reports it rather than handing
// back an empty folder a browser would refuse.
func TestExtensionFolder_WithNoBundleReportsIt(t *testing.T) {
	svc := bridgesvc.New(&stubAuth{token: "good"}, slog.New(slog.DiscardHandler))
	if _, err := svc.ExtensionFolder(); err == nil {
		t.Fatal("ExtensionFolder with no bundle returned no error")
	}
}

// Revealing always hands back the path: a browser's "Load unpacked"
// dialog needs it, and server mode has no file manager to open.
func TestRevealExtensionFolder_ReturnsThePathRegardless(t *testing.T) {
	svc := bridgesvc.New(&stubAuth{token: "good"}, slog.New(slog.DiscardHandler))
	parent := t.TempDir()
	svc.SetExtensionBundle(bundle(), parent)
	dir, err := svc.RevealExtensionFolder()
	if err != nil {
		t.Fatalf("RevealExtensionFolder: %v", err)
	}
	if dir != filepath.Join(parent, "browser-extension") {
		t.Errorf("RevealExtensionFolder() = %q, want the extension folder", dir)
	}
}
