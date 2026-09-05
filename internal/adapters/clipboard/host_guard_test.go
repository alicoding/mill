package clipboard

import "testing"

// TestNewHost_PanicsInsideATestBinaryWithoutTheOptIn pins goal 0356's
// safety net directly: NewHost must refuse to construct at all from a
// `go test` binary unless the caller has explicitly opted in via
// MILL_CLIPBOARD_HOST_OK, regardless of how it's reached (New() or a
// direct NewHost() call).
func TestNewHost_PanicsInsideATestBinaryWithoutTheOptIn(t *testing.T) {
	t.Setenv("MILL_CLIPBOARD_HOST_OK", "")
	defer func() {
		if recover() == nil {
			t.Fatal("NewHost() inside a go test binary with MILL_CLIPBOARD_HOST_OK unset: want a panic, got none")
		}
	}()
	NewHost()
}

func TestNewHost_ConstructsWithTheOptIn(t *testing.T) {
	t.Setenv("MILL_CLIPBOARD_HOST_OK", "1")
	if h := NewHost(); h == nil {
		t.Fatal("NewHost() with MILL_CLIPBOARD_HOST_OK=1: want a non-nil *Host")
	}
}
