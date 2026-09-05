package dotenvscan

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func write(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestScan_FindsDotenvFilesAndSkipsWhatItMust(t *testing.T) {
	root := t.TempDir()
	write(t, filepath.Join(root, ".env"), "A=1\nB=2\n")
	write(t, filepath.Join(root, "api", ".env.local"), "C=3\n")
	write(t, filepath.Join(root, "api", "prod.env"), "D=4\n")
	write(t, filepath.Join(root, "node_modules", "pkg", ".env"), "NOPE=1\n")
	write(t, filepath.Join(root, ".git", ".env"), "NOPE=1\n")
	write(t, filepath.Join(root, "vendor", ".env"), "NOPE=1\n")
	write(t, filepath.Join(root, "dist", ".env"), "NOPE=1\n")
	write(t, filepath.Join(root, ".hidden", ".env"), "NOPE=1\n")
	write(t, filepath.Join(root, "a", "b", "c", "d", "e", ".env"), "NOPE=1\n")
	write(t, filepath.Join(root, "readme.md"), "not an env file")

	found, err := Scan(root)
	if err != nil {
		t.Fatal(err)
	}
	paths := make([]string, 0, len(found))
	for _, f := range found {
		paths = append(paths, f.RelPath)
	}
	if strings.Join(paths, ",") != ".env,api/.env.local,api/prod.env" {
		t.Fatalf("found = %v", paths)
	}
	if found[0].Keys != 2 || found[1].Keys != 1 {
		t.Fatalf("key counts = %+v", found)
	}
}

// A scan without a folder is refused by name: there is no folder Mill
// may walk on its own, and the home directory is never a default.
func TestScan_RefusesAnEmptyFolder(t *testing.T) {
	if _, err := Scan("  "); err == nil || !strings.Contains(err.Error(), "choose a folder") {
		t.Fatalf("empty folder: %v", err)
	}
}

func TestIsDotenvName(t *testing.T) {
	for _, yes := range []string{".env", ".env.local", ".env.production", "prod.env", "staging.env"} {
		if !IsDotenvName(yes) {
			t.Errorf("%q should match", yes)
		}
	}
	for _, no := range []string{"env", "readme.md", ".environment", "envrc", ".envelope"} {
		if IsDotenvName(no) {
			t.Errorf("%q should not match", no)
		}
	}
}

func TestSourceLabelAndImportTag_NameTheParentFolder(t *testing.T) {
	root := t.TempDir()
	f := Found{RelPath: "api/.env.local"}
	if got := SourceLabel(root, f); got != "api/.env.local" {
		t.Errorf("label = %q", got)
	}
	if got := ImportTag(root, f); got != "api" {
		t.Errorf("tag = %q", got)
	}
}
