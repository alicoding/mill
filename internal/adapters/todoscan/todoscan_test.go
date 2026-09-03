package todoscan

import (
	"os"
	"path/filepath"
	"testing"
)

func writeFixtureFile(t *testing.T, root, rel, content string) string {
	t.Helper()
	path := filepath.Join(root, rel)
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	return path
}

var defaultOpts = Options{Markers: []string{"TODO", "FIXME", "HACK", "XXX"}, MaxFiles: 5000}

func TestScan_HitsAcrossTwoFiles(t *testing.T) {
	root := t.TempDir()
	writeFixtureFile(t, root, "a.go", "package a\n// TODO: first\nfunc f() {}\n")
	writeFixtureFile(t, root, "sub/b.md", "notes\n# FIXME second\nmore text\n")

	matches, err := Scan(root, defaultOpts)
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	if len(matches) != 2 {
		t.Fatalf("Scan() = %d matches, want 2: %+v", len(matches), matches)
	}
	if matches[0].File != "a.go" || matches[0].Line != 2 || matches[0].Marker != "TODO" || matches[0].Text != "first" {
		t.Errorf("matches[0] = %+v, want a.go:2 TODO \"first\"", matches[0])
	}
	if matches[1].File != "sub/b.md" || matches[1].Line != 2 || matches[1].Marker != "FIXME" || matches[1].Text != "second" {
		t.Errorf("matches[1] = %+v, want sub/b.md:2 FIXME \"second\"", matches[1])
	}
}

func TestScan_WholeWordMatchingSkipsTODOS(t *testing.T) {
	root := t.TempDir()
	writeFixtureFile(t, root, "a.txt", "TODOS should not match\nbut TODO: this should\n")

	matches, err := Scan(root, defaultOpts)
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	if len(matches) != 1 || matches[0].Line != 2 {
		t.Fatalf("Scan() = %+v, want exactly one hit on line 2", matches)
	}
}

func TestScan_SkipsDotDirsAndKnownSkipList(t *testing.T) {
	root := t.TempDir()
	writeFixtureFile(t, root, ".git/HEAD", "TODO: buried in git\n")
	writeFixtureFile(t, root, "node_modules/pkg/index.js", "// TODO: buried in node_modules\n")
	writeFixtureFile(t, root, "vendor/lib/x.go", "// TODO: buried in vendor\n")
	writeFixtureFile(t, root, "dist/out.js", "// TODO: buried in dist\n")
	writeFixtureFile(t, root, "bin/tool", "TODO buried in bin\n")
	writeFixtureFile(t, root, ".hidden/file.txt", "TODO buried in a dot-dir\n")
	writeFixtureFile(t, root, "real.go", "// TODO: this one counts\n")

	matches, err := Scan(root, defaultOpts)
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	if len(matches) != 1 || matches[0].File != "real.go" {
		t.Fatalf("Scan() = %+v, want exactly the real.go hit", matches)
	}
}

func TestScan_SkipsBinaryFiles(t *testing.T) {
	root := t.TempDir()
	binPath := filepath.Join(root, "bad.dat")
	if err := os.WriteFile(binPath, []byte("TODO: fake\x00binary marker"), 0o600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	writeFixtureFile(t, root, "good.txt", "TODO: real hit\n")

	matches, err := Scan(root, defaultOpts)
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	if len(matches) != 1 || matches[0].File != "good.txt" {
		t.Fatalf("Scan() = %+v, want only good.txt's hit", matches)
	}
}

func TestScan_SkipsOversizedFiles(t *testing.T) {
	root := t.TempDir()
	big := make([]byte, MaxFileBytes+1)
	for i := range big {
		big[i] = 'a'
	}
	if err := os.WriteFile(filepath.Join(root, "big.txt"), big, 0o600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	writeFixtureFile(t, root, "small.txt", "TODO: real hit\n")

	matches, err := Scan(root, defaultOpts)
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	if len(matches) != 1 || matches[0].File != "small.txt" {
		t.Fatalf("Scan() = %+v, want only small.txt's hit", matches)
	}
}

func TestScan_ExtensionFilter(t *testing.T) {
	root := t.TempDir()
	writeFixtureFile(t, root, "a.go", "// TODO: go file\n")
	writeFixtureFile(t, root, "b.md", "TODO: markdown file\n")

	opts := defaultOpts
	opts.Extensions = []string{"go"}
	matches, err := Scan(root, opts)
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	if len(matches) != 1 || matches[0].File != "a.go" {
		t.Fatalf("Scan() = %+v, want only a.go's hit", matches)
	}
}

func TestScan_RelativePathsUseForwardSlashes(t *testing.T) {
	root := t.TempDir()
	writeFixtureFile(t, root, "nested/deeper/c.go", "// TODO: nested\n")

	matches, err := Scan(root, defaultOpts)
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	if len(matches) != 1 || matches[0].File != "nested/deeper/c.go" {
		t.Fatalf("Scan() = %+v, want File \"nested/deeper/c.go\"", matches)
	}
}

func TestScan_MaxFilesStopsTheWalk(t *testing.T) {
	root := t.TempDir()
	for i := 0; i < 5; i++ {
		writeFixtureFile(t, root, filepath.Join("f", string(rune('a'+i))+".txt"), "TODO: hit\n")
	}
	opts := defaultOpts
	opts.MaxFiles = 2
	matches, err := Scan(root, opts)
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	if len(matches) > 2 {
		t.Fatalf("Scan() = %d matches, want at most MaxFiles (2)", len(matches))
	}
}

func TestScan_NotADirectoryErrors(t *testing.T) {
	root := t.TempDir()
	path := writeFixtureFile(t, root, "file.txt", "not a dir\n")
	if _, err := Scan(path, defaultOpts); err == nil {
		t.Fatal("Scan(file) returned nil error, want an error naming it's not a directory")
	}
}

func TestScan_MissingPathErrors(t *testing.T) {
	if _, err := Scan(filepath.Join(t.TempDir(), "does-not-exist"), defaultOpts); err == nil {
		t.Fatal("Scan(missing path) returned nil error, want one")
	}
}

func TestScan_NonPositiveMaxFilesErrors(t *testing.T) {
	root := t.TempDir()
	opts := defaultOpts
	opts.MaxFiles = 0
	if _, err := Scan(root, opts); err == nil {
		t.Fatal("Scan(MaxFiles: 0) returned nil error, want one")
	}
}

func TestScan_NoMarkersErrors(t *testing.T) {
	root := t.TempDir()
	opts := Options{MaxFiles: 5000}
	if _, err := Scan(root, opts); err == nil {
		t.Fatal("Scan(no markers) returned nil error, want one")
	}
}
