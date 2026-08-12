// Package shellenv captures the user's real login-shell PATH so an
// ExecEnv can materialize it -- ADR-0026's Amendment ("Capture from my
// shell": determinism through materialization, clean mode AND your
// Homebrew/mise paths, because they're written down, never
// re-derived). Same adapter shape as fileread/htmlextract: one small
// OS-plumbing concern behind Mill's own function name.
package shellenv

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"
)

// captureTimeout bounds CapturePath's shell invocation -- a broken shell
// profile can hang (a profile that prompts, an `exec` loop), and this
// must not hang its caller (the RPC) indefinitely.
const captureTimeout = 10 * time.Second

// CapturePath runs the user's login shell (from $SHELL, falling back
// to macOS's default /bin/zsh) with -l -c so the login startup files
// run exactly as a real terminal's would, and returns the resulting
// $PATH value. A GUI-launched Mill process's own ambient PATH is
// deliberately NOT the answer here -- Finder-launched apps get the
// minimal launchd PATH, which is exactly the staleness this capture
// exists to bypass.
func CapturePath() (string, error) {
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/zsh"
	}
	ctx, cancel := context.WithTimeout(context.Background(), captureTimeout)
	defer cancel()
	// shell comes from the user's own $SHELL (or the macOS default) --
	// this process already runs with the user's own privileges, so
	// there's no privilege boundary being crossed by running their own
	// configured shell; exec.CommandContext never invokes a shell of its
	// own (argv goes straight to execve), so there's no injection
	// surface via the fixed "-l"/"-c"/printf arguments either.
	cmd := exec.CommandContext(ctx, shell, "-l", "-c", `printf %s "$PATH"`) //nolint:gosec // runs the user's own $SHELL with the user's own privileges, by design
	out, err := cmd.Output()
	if err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return "", fmt.Errorf("shell %s did not produce a PATH within %s -- a login profile may be hanging", shell, captureTimeout)
		}
		return "", fmt.Errorf("running %s -l failed: %w", shell, err)
	}
	path := strings.TrimSpace(string(out))
	if path == "" {
		return "", fmt.Errorf("shell %s returned an empty PATH", shell)
	}
	return path, nil
}
