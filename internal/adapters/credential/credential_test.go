package credential

import (
	"errors"
	"testing"

	"github.com/zalando/go-keyring"
)

func TestMain(m *testing.M) {
	// MockInit swaps in an in-memory keyring -- the real OS keychain
	// isn't CI-testable (no headless macOS Keychain session, same class
	// of gap docs/SPEC.md §1.3 already notes for internal/adapters/
	// clipboard), but unlike clipboard this adapter ships its own mock,
	// so the round-trip below is real test coverage, not a skip.
	keyring.MockInit()
	m.Run()
}

func TestSetGet_RoundTrips(t *testing.T) {
	s := New()
	if err := s.Set("conn-1", "s3cr3t"); err != nil {
		t.Fatalf("Set returned error: %v", err)
	}
	got, err := s.Get("conn-1")
	if err != nil {
		t.Fatalf("Get returned error: %v", err)
	}
	if got != "s3cr3t" {
		t.Errorf("Get() = %q, want %q", got, "s3cr3t")
	}
}

func TestSet_OverwritesExisting(t *testing.T) {
	s := New()
	if err := s.Set("conn-2", "first"); err != nil {
		t.Fatalf("Set returned error: %v", err)
	}
	if err := s.Set("conn-2", "second"); err != nil {
		t.Fatalf("Set returned error: %v", err)
	}
	got, err := s.Get("conn-2")
	if err != nil {
		t.Fatalf("Get returned error: %v", err)
	}
	if got != "second" {
		t.Errorf("Get() = %q, want the overwritten value %q", got, "second")
	}
}

func TestGet_NotFound(t *testing.T) {
	s := New()
	_, err := s.Get("does-not-exist")
	if !errors.Is(err, keyring.ErrNotFound) {
		t.Errorf("Get(unknown connector) error = %v, want keyring.ErrNotFound", err)
	}
}

func TestDelete_RemovesSecret(t *testing.T) {
	s := New()
	if err := s.Set("conn-3", "temp"); err != nil {
		t.Fatalf("Set returned error: %v", err)
	}
	if err := s.Delete("conn-3"); err != nil {
		t.Fatalf("Delete returned error: %v", err)
	}
	if _, err := s.Get("conn-3"); !errors.Is(err, keyring.ErrNotFound) {
		t.Errorf("Get after Delete error = %v, want keyring.ErrNotFound", err)
	}
}
