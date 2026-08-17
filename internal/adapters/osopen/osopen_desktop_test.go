//go:build !server

package osopen

import (
	"os/exec"
	"testing"
)

// TestOpen_BuildsPlainOpenCommand pins the exact argv Open shells out
// to -- macOS `open <path>`, no flags, distinguishing it from Reveal's
// `-R` below.
func TestOpen_BuildsPlainOpenCommand(t *testing.T) {
	cmd := openCmd("/tmp/example.md")
	want := []string{"open", "/tmp/example.md"}
	assertArgs(t, cmd, want)
}

// TestReveal_BuildsDashRCommand pins Reveal's own argv -- `open -R
// <path>`, the flag that selects the file in the file manager instead
// of launching it.
func TestReveal_BuildsDashRCommand(t *testing.T) {
	cmd := revealCmd("/tmp/example.md")
	want := []string{"open", "-R", "/tmp/example.md"}
	assertArgs(t, cmd, want)
}

func assertArgs(t *testing.T, cmd *exec.Cmd, want []string) {
	t.Helper()
	if len(cmd.Args) != len(want) {
		t.Fatalf("cmd.Args = %v, want %v", cmd.Args, want)
	}
	for i, arg := range want {
		if cmd.Args[i] != arg {
			t.Errorf("cmd.Args[%d] = %q, want %q", i, cmd.Args[i], arg)
		}
	}
}

// TestOpen_StartError exercises the cmd.Start() error path (same
// technique Wails3's own internal/browser tests use: a PATH pointing
// nowhere means the bare "open" command can never be resolved).
func TestOpen_StartError(t *testing.T) {
	t.Setenv("PATH", "/nonexistent_path_that_does_not_exist")
	if err := Open("/tmp/x"); err == nil {
		t.Error("Open with an empty PATH returned nil error, want an error")
	}
}

// TestReveal_StartError is Reveal's own twin of the above.
func TestReveal_StartError(t *testing.T) {
	t.Setenv("PATH", "/nonexistent_path_that_does_not_exist")
	if err := Reveal("/tmp/x"); err == nil {
		t.Error("Reveal with an empty PATH returned nil error, want an error")
	}
}
