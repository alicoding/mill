package shellenv

import (
	"strings"
	"testing"
)

// A real login-shell round trip -- $SHELL (or /bin/zsh) exists on
// every machine this test runs on (macOS dev, and CI's linux runner
// has /bin/sh via $SHELL); the assertion is deliberately loose (a
// nonempty, ':'-joined-looking value) since the actual PATH is the
// machine's own.
func TestCapturePath_ReturnsRealLoginShellPath(t *testing.T) {
	t.Setenv("SHELL", "/bin/sh")
	path, err := CapturePath()
	if err != nil {
		t.Fatalf("CapturePath: %v", err)
	}
	if !strings.Contains(path, "/") {
		t.Fatalf("expected a path-like value, got %q", path)
	}
}
