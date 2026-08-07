package filewatch

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestWatch_FiresOnFileCreate(t *testing.T) {
	dir := t.TempDir()

	fired := make(chan struct{}, 1)
	b, err := Watch(dir, func() {
		select {
		case fired <- struct{}{}:
		default:
		}
	})
	if err != nil {
		t.Fatalf("Watch() error: %v", err)
	}
	defer func() { _ = b.Close() }()

	if err := os.WriteFile(filepath.Join(dir, "new-file.txt"), []byte("hello"), 0o644); err != nil {
		t.Fatalf("WriteFile() error: %v", err)
	}

	select {
	case <-fired:
	case <-time.After(2 * time.Second):
		t.Fatal("watch never fired after a file was created")
	}
}

func TestWatch_UnknownPath(t *testing.T) {
	if _, err := Watch(filepath.Join(t.TempDir(), "does-not-exist"), func() {}); err == nil {
		t.Fatal("Watch() on a nonexistent path: want error, got nil")
	}
}

func TestWatch_CloseStopsFiring(t *testing.T) {
	dir := t.TempDir()

	fired := make(chan struct{}, 1)
	b, err := Watch(dir, func() {
		select {
		case fired <- struct{}{}:
		default:
		}
	})
	if err != nil {
		t.Fatalf("Watch() error: %v", err)
	}
	if err := b.Close(); err != nil {
		t.Fatalf("Close() error: %v", err)
	}

	if err := os.WriteFile(filepath.Join(dir, "after-close.txt"), []byte("hello"), 0o644); err != nil {
		t.Fatalf("WriteFile() error: %v", err)
	}

	select {
	case <-fired:
		t.Fatal("watch fired after Close()")
	case <-time.After(200 * time.Millisecond):
	}
}
