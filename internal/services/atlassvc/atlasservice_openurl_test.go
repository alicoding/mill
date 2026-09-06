package atlassvc

import "testing"

// TestOpenURL_RecordsInMemoryUnderTest proves OpenURL never reaches a
// real browser inside a `go test` binary -- osopen.New() resolves to
// its in-memory Port by default there, so this only pins that the call
// succeeds and is observable through DebugLastOpenedURLs, never that a
// real tab opened.
func TestOpenURL_RecordsInMemoryUnderTest(t *testing.T) {
	t.Setenv("MILL_OPEN", "memory")
	a := newTestAtlasService(t)
	const url = "https://example.com/mill-e2e-pdf-link"
	if err := a.OpenURL(url); err != nil {
		t.Fatalf("OpenURL: %v", err)
	}
	got, err := a.DebugLastOpenedURLs()
	if err != nil {
		t.Fatalf("DebugLastOpenedURLs: %v", err)
	}
	if len(got) == 0 || got[len(got)-1] != url {
		t.Fatalf("DebugLastOpenedURLs() = %v, want it to end with %q", got, url)
	}
}

// TestDebugLastOpenedURLs_RefusesOutsideMemoryMode pins the debug
// knob's own guard: it must never answer for a process that isn't
// running the in-memory Port, the same posture
// DebugCorruptVaultKeyForTests holds against MILL_TEST_KEYRING.
func TestDebugLastOpenedURLs_RefusesOutsideMemoryMode(t *testing.T) {
	t.Setenv("MILL_OPEN", "")
	a := newTestAtlasService(t)
	if _, err := a.DebugLastOpenedURLs(); err == nil {
		t.Fatal("DebugLastOpenedURLs() with MILL_OPEN unset = nil error, want a refusal")
	}
}
