package filetrash

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

// TestTrash_EmptyPathRefused pins the guard: "" must never reach the
// platform call, where it would name the working directory.
func TestTrash_EmptyPathRefused(t *testing.T) {
	if _, err := Trash(""); !errors.Is(err, ErrEmptyPath) {
		t.Fatalf("Trash(\"\") error = %v, want ErrEmptyPath", err)
	}
}

// TestTrash_ReturnsDestinationFromPlatform pins the contract every
// caller depends on: the destination the platform reports is what
// Trash returns, unmodified.
func TestTrash_ReturnsDestinationFromPlatform(t *testing.T) {
	original := trashImpl
	t.Cleanup(func() { trashImpl = original })
	trashImpl = func(path string) (string, error) { return path + "/in-the-trash", nil }

	got, err := Trash("/tmp/plugin")
	if err != nil {
		t.Fatalf("Trash: %v", err)
	}
	if got != "/tmp/plugin/in-the-trash" {
		t.Errorf("Trash = %q, want the platform's own destination", got)
	}
}

// TestTrash_MovesTheFolderAndLeavesItRecoverable exercises the real
// platform implementation for this build: the folder leaves its
// original path, and whatever destination is reported still exists.
func TestTrash_MovesTheFolderAndLeavesItRecoverable(t *testing.T) {
	root := t.TempDir()
	folder := filepath.Join(root, "acme-plugin")
	if err := os.MkdirAll(folder, 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(folder, "manifest.json"), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}

	dest, err := Trash(folder)
	if err != nil {
		t.Fatalf("Trash: %v", err)
	}
	if _, err := os.Stat(folder); !os.IsNotExist(err) {
		t.Errorf("the folder is still at its original path (stat err = %v)", err)
	}
	if dest == "" {
		t.Fatal("Trash reported no destination")
	}
	if _, err := os.Stat(dest); err != nil {
		t.Errorf("the reported destination %q is not there: %v", dest, err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dest) })
}
