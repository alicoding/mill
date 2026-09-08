package secretsvc

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/adapters/credential"
	"github.com/alicoding/mill/internal/adapters/secretaudit"
	"github.com/alicoding/mill/internal/adapters/secretvault"
	"github.com/alicoding/mill/internal/domain/secretsource"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// waitForSourcesChanged blocks on ch for a fired source id, failing the
// test if nothing arrives within a generous window -- fsnotify plus a
// real 250ms debounce means this is genuinely timing-bound, the same
// posture atlasservice_mirrorwatch_test.go's own wait already takes.
func waitForSourcesChanged(t *testing.T, ch <-chan string, want string) {
	t.Helper()
	select {
	case got := <-ch:
		if got != want {
			t.Errorf("sources-changed fired for id %q, want %q", got, want)
		}
	case <-time.After(3 * time.Second):
		t.Fatalf("sources-changed never fired for id %q", want)
	}
}

// assertNoSourcesChanged fails if anything arrives on ch within a
// window generous enough that a real (undesired) fire would have shown
// up.
func assertNoSourcesChanged(t *testing.T, ch <-chan string) {
	t.Helper()
	select {
	case got := <-ch:
		t.Errorf("sources-changed fired for id %q, want no event", got)
	case <-time.After(1500 * time.Millisecond):
	}
}

// hookSourcesChanged wires SourcesChangedTestHook to a buffered channel
// for the duration of one test -- windowing.Emit is a no-op under `go
// test` (no live Wails application), so this is the observable seam
// every test in this file uses instead.
func hookSourcesChanged(t *testing.T) <-chan string {
	t.Helper()
	ch := make(chan string, 8)
	SourcesChangedTestHook = func(id string) { ch <- id }
	t.Cleanup(func() { SourcesChangedTestHook = nil })
	return ch
}

func TestRearmSourceWatches_FiresOnExternalWrite(t *testing.T) {
	dir := t.TempDir()
	envPath := filepath.Join(dir, ".env")
	if err := os.WriteFile(envPath, []byte("API_TOKEN=tok-123\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	src := secretsource.Source{ID: "proj-env", Label: "Project .env", Kind: secretsource.KindEnv, Path: envPath, UpdatedAt: time.Now()}
	s := NewSecretService(secretvault.New(filepath.Join(dir, "secrets.kdbx")), credential.NewInMemory(), servicetest.NewFakeStore())
	t.Cleanup(s.stopAutoLock)
	t.Cleanup(s.CloseAllSourceWatches)
	s.SetSourcesLister(func() []secretsource.Source { return []secretsource.Source{src} })
	ch := hookSourcesChanged(t)
	s.RearmSourceWatches()

	if err := os.WriteFile(envPath, []byte("API_TOKEN=tok-456\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	waitForSourcesChanged(t, ch, "proj-env")

	// The re-read is live, not cached: the new value resolves the very
	// next call.
	v, err := s.ResolveSecretValue("env:proj-env/API_TOKEN", secretaudit.AccessContext{Context: secretaudit.ContextHTTPHeader})
	if err != nil || v != "tok-456" {
		t.Fatalf("resolve after write = %q, %v", v, err)
	}
}

func TestRearmSourceWatches_DroppedSourceStopsWatching(t *testing.T) {
	dir := t.TempDir()
	envPath := filepath.Join(dir, ".env")
	if err := os.WriteFile(envPath, []byte("API_TOKEN=tok-123\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	src := secretsource.Source{ID: "proj-env", Label: "Project .env", Kind: secretsource.KindEnv, Path: envPath, UpdatedAt: time.Now()}
	sources := []secretsource.Source{src}
	s := NewSecretService(secretvault.New(filepath.Join(dir, "secrets.kdbx")), credential.NewInMemory(), servicetest.NewFakeStore())
	t.Cleanup(s.stopAutoLock)
	t.Cleanup(s.CloseAllSourceWatches)
	s.SetSourcesLister(func() []secretsource.Source { return sources })
	ch := hookSourcesChanged(t)
	s.RearmSourceWatches()

	// The source is removed from the list (as a real delete would), and
	// the watch set is told to recompute -- the same call
	// configuresvc.SetSecretSourcesChanged wires after a delete.
	sources = nil
	s.RearmSourceWatches()

	if err := os.WriteFile(envPath, []byte("API_TOKEN=tok-456\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	assertNoSourcesChanged(t, ch)
}

func TestRearmSourceWatches_UnwatchableSourceIsSkippedNotFatal(t *testing.T) {
	dir := t.TempDir()
	broken := secretsource.Source{ID: "broken", Label: "Broken", Kind: secretsource.KindEnv, Path: filepath.Join(dir, "missing", ".env"), UpdatedAt: time.Now()}
	s := NewSecretService(secretvault.New(filepath.Join(dir, "secrets.kdbx")), credential.NewInMemory(), servicetest.NewFakeStore())
	t.Cleanup(s.stopAutoLock)
	t.Cleanup(s.CloseAllSourceWatches)
	s.SetSourcesLister(func() []secretsource.Source { return []secretsource.Source{broken} })

	// A source whose directory does not exist yet must not panic or
	// block arming every other source -- SourceProblems already reports
	// why the source itself lists nothing.
	s.RearmSourceWatches()
}
