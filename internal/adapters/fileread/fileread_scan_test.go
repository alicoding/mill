package fileread

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func mustMkdir(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(path, 0o750); err != nil {
		t.Fatalf("MkdirAll(%q): %v", path, err)
	}
}

func mustWriteFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("WriteFile(%q): %v", path, err)
	}
}

func TestScan_HiddenEntriesSkipped(t *testing.T) {
	root := t.TempDir()
	mustWriteFile(t, filepath.Join(root, "visible.txt"), "x")
	mustWriteFile(t, filepath.Join(root, ".hidden.txt"), "x")
	mustMkdir(t, filepath.Join(root, ".hidden-dir"))

	result, err := Scan(root, 3, 500)
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	if len(result.Entries) != 1 || result.Entries[0].Name != "visible.txt" {
		t.Errorf("Scan() entries = %+v, want only visible.txt", result.Entries)
	}
}

func TestScan_SymlinkNeverFollowedOrReported(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink creation needs elevated privileges on windows")
	}
	root := t.TempDir()
	outside := t.TempDir()
	mustWriteFile(t, filepath.Join(outside, "secret.txt"), "should never be scanned")
	mustWriteFile(t, filepath.Join(root, "real.txt"), "x")
	if err := os.Symlink(outside, filepath.Join(root, "link-to-outside")); err != nil {
		t.Fatalf("Symlink: %v", err)
	}

	result, err := Scan(root, 3, 500)
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	for _, e := range result.Entries {
		if e.Name == "link-to-outside" {
			t.Error("Scan() reported a symlink entry -- symlinks must be skipped entirely")
		}
		if e.Name == "secret.txt" {
			t.Error("Scan() followed a symlink outside root -- must never happen")
		}
	}
	if len(result.Entries) != 1 || result.Entries[0].Name != "real.txt" {
		t.Errorf("Scan() entries = %+v, want only real.txt", result.Entries)
	}
}

func TestScan_DepthLimit(t *testing.T) {
	root := t.TempDir()
	// root/a/b/c/deep.txt -- depth 4, one past the default cap of 3.
	deepDir := filepath.Join(root, "a", "b", "c")
	mustMkdir(t, deepDir)
	mustWriteFile(t, filepath.Join(deepDir, "deep.txt"), "x")

	result, err := Scan(root, 3, 500)
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	for _, e := range result.Entries {
		if e.Name == "deep.txt" {
			t.Error("Scan() with maxDepth=3 reported an entry past that depth")
		}
	}
	// "a" (depth 1) and "a/b" (depth 2) are still listed -- only
	// recursion INTO depth-3 "c" is skipped, not its own listing.
	found := map[string]bool{}
	for _, e := range result.Entries {
		found[e.RelPath] = true
	}
	if !found["a"] || !found["a/b"] || !found["a/b/c"] {
		t.Errorf("Scan() entries = %+v, want a, a/b, a/b/c all listed (depth 3 is the last LISTED level)", result.Entries)
	}
}

func TestScan_CountCapTruncates(t *testing.T) {
	root := t.TempDir()
	for i := 0; i < 10; i++ {
		mustWriteFile(t, filepath.Join(root, string(rune('a'+i))+".txt"), "x")
	}

	result, err := Scan(root, 3, 5)
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	if len(result.Entries) != 5 {
		t.Errorf("Scan() with maxEntries=5 returned %d entries, want 5", len(result.Entries))
	}
	if !result.Truncated {
		t.Error("Scan() hit the count cap but Truncated is false")
	}
}

func TestScan_RelPathsAreForwardSlashAndDeterministicOrder(t *testing.T) {
	root := t.TempDir()
	mustMkdir(t, filepath.Join(root, "sub"))
	mustWriteFile(t, filepath.Join(root, "sub", "file.txt"), "x")
	mustWriteFile(t, filepath.Join(root, "b.txt"), "x")
	mustWriteFile(t, filepath.Join(root, "a.txt"), "x")

	first, err := Scan(root, 3, 500)
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	second, err := Scan(root, 3, 500)
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	if len(first.Entries) != len(second.Entries) {
		t.Fatalf("two scans of unchanged content produced different entry counts: %d vs %d", len(first.Entries), len(second.Entries))
	}
	for i := range first.Entries {
		if first.Entries[i] != second.Entries[i] {
			t.Errorf("scan order not deterministic at index %d: %+v vs %+v", i, first.Entries[i], second.Entries[i])
		}
	}

	var sawSubFile bool
	for _, e := range first.Entries {
		if e.Name == "file.txt" {
			sawSubFile = true
			if e.RelPath != "sub/file.txt" {
				t.Errorf("RelPath = %q, want forward-slash %q", e.RelPath, "sub/file.txt")
			}
			if e.ParentRelPath != "sub" {
				t.Errorf("ParentRelPath = %q, want %q", e.ParentRelPath, "sub")
			}
		}
	}
	if !sawSubFile {
		t.Fatal("expected sub/file.txt among scan entries")
	}
}

func TestScan_MissingRootErrors(t *testing.T) {
	if _, err := Scan(filepath.Join(t.TempDir(), "does-not-exist"), 3, 500); err == nil {
		t.Error("Scan() on a missing root = nil error, want an error")
	}
}

func TestScan_NotADirectoryErrors(t *testing.T) {
	root := t.TempDir()
	filePath := filepath.Join(root, "file.txt")
	mustWriteFile(t, filePath, "x")
	if _, err := Scan(filePath, 3, 500); err == nil {
		t.Error("Scan() on a file (not a directory) = nil error, want an error")
	}
}
