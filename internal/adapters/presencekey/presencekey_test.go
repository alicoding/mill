package presencekey

import (
	"errors"
	"testing"
)

// Read's goroutine/channel wrapping is the only presencekey behavior
// exercisable without a live authentication prompt or the real
// keychain -- everything darwin-specific (presencekey_darwin.go) is
// OS-bound and covered by testing.md's manual-only registry instead.
// These tests swap readImpl/removeImpl directly, the same
// package-var-fake shape launchatlogin_manager_test.go's autostartAPI
// fakes use.

func TestRead_ReturnsImplResult(t *testing.T) {
	orig := readImpl
	t.Cleanup(func() { readImpl = orig })
	readImpl = func(service, account, prompt string) ([]byte, error) {
		return []byte("fake-" + service + "-" + account + "-" + prompt), nil
	}

	got, err := Read("svc", "acct", "prompt")
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if string(got) != "fake-svc-acct-prompt" {
		t.Fatalf("Read = %q, want fake-svc-acct-prompt", got)
	}
}

func TestRead_PropagatesImplError(t *testing.T) {
	orig := readImpl
	t.Cleanup(func() { readImpl = orig })
	wantErr := errors.New("boom")
	readImpl = func(string, string, string) ([]byte, error) { return nil, wantErr }

	if _, err := Read("svc", "acct", "prompt"); !errors.Is(err, wantErr) {
		t.Fatalf("Read err = %v, want %v", err, wantErr)
	}
}

func TestRemove_DelegatesToImpl(t *testing.T) {
	orig := removeImpl
	t.Cleanup(func() { removeImpl = orig })
	called := false
	removeImpl = func(string, string) error { called = true; return nil }

	if err := Remove("s", "a"); err != nil {
		t.Fatalf("Remove: %v", err)
	}
	if !called {
		t.Fatal("removeImpl was not called")
	}
}
