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
	b, err := Watch(dir, "", func(string) {
		select {
		case fired <- struct{}{}:
		default:
		}
	})
	if err != nil {
		t.Fatalf("Watch() error: %v", err)
	}
	defer func() { _ = b.Close() }()

	if err := os.WriteFile(filepath.Join(dir, "new-file.txt"), []byte("hello"), 0o600); err != nil {
		t.Fatalf("WriteFile() error: %v", err)
	}

	select {
	case <-fired:
	case <-time.After(2 * time.Second):
		t.Fatal("watch never fired after a file was created")
	}
}

func TestWatch_UnknownPath(t *testing.T) {
	if _, err := Watch(filepath.Join(t.TempDir(), "does-not-exist"), "", func(string) {}); err == nil {
		t.Fatal("Watch() on a nonexistent path: want error, got nil")
	}
}

func TestWatch_CloseStopsFiring(t *testing.T) {
	dir := t.TempDir()

	fired := make(chan struct{}, 1)
	b, err := Watch(dir, "", func(string) {
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

	if err := os.WriteFile(filepath.Join(dir, "after-close.txt"), []byte("hello"), 0o600); err != nil {
		t.Fatalf("WriteFile() error: %v", err)
	}

	select {
	case <-fired:
		t.Fatal("watch fired after Close()")
	case <-time.After(200 * time.Millisecond):
	}
}

// The glob filter (goal 0001): only matching filenames fire, and the
// changed path is delivered to the callback.
func TestWatch_PatternFilter(t *testing.T) {
	dir := t.TempDir()
	fired := make(chan string, 4)
	b, err := Watch(dir, "*.md", func(changed string) {
		select {
		case fired <- changed:
		default:
		}
	})
	if err != nil {
		t.Fatalf("Watch() error: %v", err)
	}
	defer func() { _ = b.Close() }()

	// A non-matching file must NOT fire.
	if err := os.WriteFile(filepath.Join(dir, "ignore.txt"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	// A matching file must fire, delivering its path.
	mdPath := filepath.Join(dir, "note.md")
	if err := os.WriteFile(mdPath, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}

	select {
	case got := <-fired:
		if filepath.Base(got) != "note.md" {
			t.Fatalf("fired for %q, want the .md file", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("pattern watch never fired for the matching .md file")
	}
	// Give a beat; the .txt must not have queued anything.
	select {
	case got := <-fired:
		if filepath.Base(got) == "ignore.txt" {
			t.Fatal("non-matching .txt file fired the pattern watch")
		}
	default:
	}
}

func TestWatch_InvalidPattern(t *testing.T) {
	if _, err := Watch(t.TempDir(), "[", func(string) {}); err == nil {
		t.Fatal("Watch() with a malformed glob: want error, got nil")
	}
}
