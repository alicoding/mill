package fileread

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRead_ReturnsFileContents(t *testing.T) {
	path := filepath.Join(t.TempDir(), "page.html")
	const want = "<main id=\"main-content\">hello</main>"
	if err := os.WriteFile(path, []byte(want), 0o600); err != nil {
		t.Fatal(err)
	}

	got, err := Read(path)
	if err != nil {
		t.Fatalf("Read() error: %v", err)
	}
	if got != want {
		t.Errorf("Read() = %q, want %q", got, want)
	}
}

func TestRead_MissingFile_Errors(t *testing.T) {
	_, err := Read(filepath.Join(t.TempDir(), "does-not-exist.html"))
	if err == nil {
		t.Fatal("Read() error = nil, want an error for a missing file")
	}
}

func TestRead_EmptyPath_Errors(t *testing.T) {
	_, err := Read("")
	if err == nil {
		t.Fatal("Read() error = nil, want an error for an empty path")
	}
}

func TestRead_OverSizeLimit_Errors(t *testing.T) {
	path := filepath.Join(t.TempDir(), "huge.html")
	f, err := os.Create(path) //nolint:gosec // t.TempDir()-scoped test fixture path, not user input
	if err != nil {
		t.Fatal(err)
	}
	// Sparse-truncate to MaxBytes+1 -- proves the size guard (checked
	// via os.Stat, before any read) without actually writing 10MB+1
	// real bytes to disk.
	if err := f.Truncate(MaxBytes + 1); err != nil {
		_ = f.Close()
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}

	_, err = Read(path)
	if err == nil {
		t.Fatal("Read() error = nil, want an error for a file over MaxBytes")
	}
	if !strings.Contains(err.Error(), "limit") {
		t.Errorf("Read() error = %q, want it to mention the size limit", err.Error())
	}
}

func TestStat_ReturnsSizeWithoutReading(t *testing.T) {
	path := filepath.Join(t.TempDir(), "page.html")
	const content = "<main id=\"main-content\">hello</main>"
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}

	got, err := Stat(path)
	if err != nil {
		t.Fatalf("Stat() error: %v", err)
	}
	if got != int64(len(content)) {
		t.Errorf("Stat() = %d, want %d", got, len(content))
	}
}

func TestStat_MissingFile_Errors(t *testing.T) {
	if _, err := Stat(filepath.Join(t.TempDir(), "does-not-exist.html")); err == nil {
		t.Fatal("Stat() error = nil, want an error for a missing file")
	}
}

func TestStat_EmptyPath_Errors(t *testing.T) {
	if _, err := Stat(""); err == nil {
		t.Fatal("Stat() error = nil, want an error for an empty path")
	}
}

func TestStat_Directory_Errors(t *testing.T) {
	if _, err := Stat(t.TempDir()); err == nil {
		t.Fatal("Stat() error = nil, want an error for a directory")
	}
}
