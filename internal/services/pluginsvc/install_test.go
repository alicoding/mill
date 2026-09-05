package pluginsvc

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// zipOf builds an in-memory archive from name -> contents.
func zipOf(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, body := range files {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte(body)); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestExtractZip_UnwrapsTheSingleTopLevelFolder(t *testing.T) {
	dest := t.TempDir()
	data := zipOf(t, map[string]string{
		"acme-notes-1.0.0/manifest.json": `{"id":"acme-notes"}`,
		"acme-notes-1.0.0/main.js":       "export function activate() {}",
	})
	if err := ExtractZip(data, dest); err != nil {
		t.Fatalf("ExtractZip() = %v", err)
	}
	if _, err := os.Stat(filepath.Join(dest, "manifest.json")); err != nil {
		t.Fatalf("manifest.json did not land at the root: %v", err)
	}
}

func TestExtractZip_KeepsAMultiRootArchiveAsItIs(t *testing.T) {
	dest := t.TempDir()
	data := zipOf(t, map[string]string{"a/one.txt": "1", "b/two.txt": "2"})
	if err := ExtractZip(data, dest); err != nil {
		t.Fatalf("ExtractZip() = %v", err)
	}
	for _, rel := range []string{"a/one.txt", "b/two.txt"} {
		if _, err := os.Stat(filepath.Join(dest, filepath.FromSlash(rel))); err != nil {
			t.Errorf("%s missing: %v", rel, err)
		}
	}
}

// Traversal refuses the WHOLE archive: a half-extracted plugin is not
// a safer outcome than none.
func TestExtractZip_RefusesAnEntryOutsideTheTargetFolder(t *testing.T) {
	dest := t.TempDir()
	data := zipOf(t, map[string]string{
		"pkg/manifest.json":    `{"id":"acme"}`,
		"pkg/../../escape.txt": "nope",
	})
	if err := ExtractZip(data, dest); err == nil {
		t.Fatal("ExtractZip() = nil error, want a traversal refusal")
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(dest), "escape.txt")); err == nil {
		t.Fatal("the traversal entry was written")
	}
}

// Regression: an entry naming "../evil" at the archive's own top level
// (alongside an unrelated root, so no single-folder unwrap swallows the
// ".." before the traversal guard ever sees it) must still be refused
// before any directory or file is created under dest.
func TestExtractZip_RefusesATopLevelParentEntry(t *testing.T) {
	dest := t.TempDir()
	data := zipOf(t, map[string]string{
		"safe/manifest.json": `{"id":"acme"}`,
		"../evil":             "nope",
	})
	if err := ExtractZip(data, dest); err == nil {
		t.Fatal("ExtractZip() = nil error, want a traversal refusal")
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(dest), "evil")); err == nil {
		t.Fatal("the traversal entry was written")
	}
}

func TestExtractZip_RefusesASymbolicLink(t *testing.T) {
	dest := t.TempDir()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	hdr := &zip.FileHeader{Name: "pkg/link"}
	hdr.SetMode(os.ModeSymlink | 0o777)
	w, err := zw.CreateHeader(hdr)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.Write([]byte("/etc/passwd")); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := ExtractZip(buf.Bytes(), dest); err == nil || !strings.Contains(err.Error(), "symbolic link") {
		t.Fatalf("err = %v, want a symlink refusal", err)
	}
}

func TestExtractZip_RefusesSomethingThatIsNotAZip(t *testing.T) {
	if err := ExtractZip([]byte("not a zip at all"), t.TempDir()); err == nil {
		t.Fatal("ExtractZip() = nil error, want a refusal")
	}
}

func TestManifestIDIn_FindsTheIDAtTheRootOrOneLevelDown(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "manifest.json"), []byte(`{"id":"acme-notes"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	id, dir, err := ManifestIDIn(root)
	if err != nil || id != "acme-notes" || dir != root {
		t.Fatalf("ManifestIDIn(root) = %q %q %v", id, dir, err)
	}

	nested := t.TempDir()
	sub := filepath.Join(nested, "acme-notes-1.0.0")
	if err := os.MkdirAll(sub, 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sub, "manifest.json"), []byte(`{"id":"acme-notes"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	id, dir, err = ManifestIDIn(nested)
	if err != nil || id != "acme-notes" || dir != sub {
		t.Fatalf("ManifestIDIn(nested) = %q %q %v", id, dir, err)
	}
}

func TestManifestIDIn_RefusesADownloadWithNoManifest(t *testing.T) {
	if _, _, err := ManifestIDIn(t.TempDir()); err == nil {
		t.Fatal("ManifestIDIn() = nil error, want a refusal")
	}
}

func TestCopyPluginFolder_SkipsHiddenEntriesAndDependencyFolders(t *testing.T) {
	src := t.TempDir()
	write := func(rel, body string) {
		full := filepath.Join(src, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(full), 0o750); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	write("manifest.json", `{"id":"acme-notes"}`)
	write(".DS_Store", "junk")
	write("node_modules/dep/index.js", "dep")
	dest := filepath.Join(t.TempDir(), "acme-notes")
	if err := CopyPluginFolder(src, dest); err != nil {
		t.Fatalf("CopyPluginFolder() = %v", err)
	}
	if _, err := os.Stat(filepath.Join(dest, "manifest.json")); err != nil {
		t.Errorf("manifest.json not copied: %v", err)
	}
	for _, rel := range []string{".DS_Store", "node_modules"} {
		if _, err := os.Stat(filepath.Join(dest, rel)); err == nil {
			t.Errorf("%s was copied, want it skipped", rel)
		}
	}
}

func TestSHA256Hex_IsTheBareDigestASourceDeclares(t *testing.T) {
	// The published digest of the empty input, the one value a reader
	// can check by hand.
	if got := SHA256Hex(nil); got != "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" {
		t.Errorf("SHA256Hex(nil) = %q", got)
	}
}
