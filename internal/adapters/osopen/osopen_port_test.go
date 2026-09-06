package osopen

import (
	"fmt"
	"testing"
)

// TestNew_MillOpenUnset_ResolvesToMemory pins the selection rule's
// default: inside a `go test` binary (always testing.Testing() ==
// true), an unset MILL_OPEN must never construct the real Host, which
// would panic without MILL_OPEN_HOST_OK.
func TestNew_MillOpenUnset_ResolvesToMemory(t *testing.T) {
	t.Setenv("MILL_OPEN", "")
	if _, ok := New().(*Memory); !ok {
		t.Fatalf("New() with MILL_OPEN unset inside a test binary = %T, want *Memory", New())
	}
}

func TestNew_MillOpenMemory_ResolvesToMemory(t *testing.T) {
	t.Setenv("MILL_OPEN", "memory")
	if _, ok := New().(*Memory); !ok {
		t.Fatalf("New() with MILL_OPEN=memory = %T, want *Memory", New())
	}
}

// TestNew_MillOpenHost_ResolvesToHost pins the explicit override: a
// test that deliberately wants the real opener sets both MILL_OPEN=host
// and the NewHost guard's own opt-in.
func TestNew_MillOpenHost_ResolvesToHost(t *testing.T) {
	t.Setenv("MILL_OPEN", "host")
	t.Setenv("MILL_OPEN_HOST_OK", "1")
	if _, ok := New().(*Host); !ok {
		t.Fatalf("New() with MILL_OPEN=host = %T, want *Host", New())
	}
}

func TestMemory_OpenURL_RecordsWithoutOpening(t *testing.T) {
	m := NewMemory()
	if err := m.OpenURL("https://example.com/a"); err != nil {
		t.Fatalf("OpenURL: %v", err)
	}
	got := m.OpenedURLs()
	if len(got) != 1 || got[0] != "https://example.com/a" {
		t.Fatalf("OpenedURLs() = %v, want [https://example.com/a]", got)
	}
}

// TestMemory_OpenedURLs_CapsAtMemoryCap pins the retained-history cap:
// a long-running e2e worker's recorder must never grow unbounded, and
// the most recent entry must always survive the cap.
func TestMemory_OpenedURLs_CapsAtMemoryCap(t *testing.T) {
	m := NewMemory()
	for i := range memoryCap + 5 {
		if err := m.OpenURL(fmt.Sprintf("https://example.com/%d", i)); err != nil {
			t.Fatalf("OpenURL(%d): %v", i, err)
		}
	}
	got := m.OpenedURLs()
	if len(got) != memoryCap {
		t.Fatalf("len(OpenedURLs()) = %d, want %d", len(got), memoryCap)
	}
	want := fmt.Sprintf("https://example.com/%d", memoryCap+4)
	if got[len(got)-1] != want {
		t.Fatalf("last entry = %q, want %q (the most recent URL)", got[len(got)-1], want)
	}
}
