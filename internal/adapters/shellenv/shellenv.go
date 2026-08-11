// Package shellenv captures the user's real login-shell PATH so an
// ExecEnv can materialize it -- ADR-0026's Amendment ("Capture from my
// shell": determinism through materialization, clean mode AND your
// Homebrew/mise paths, because they're written down, never
// re-derived). Same adapter shape as fileread/htmlextract: one small
// OS-plumbing concern behind Mill's own function name.
package shellenv

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"
)

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
	cmd := exec.Command(shell, "-l", "-c", `printf %s "$PATH"`)
	// A broken shell profile can hang (a profile that prompts, an
	// `exec` loop) -- bound it rather than hanging the RPC.
	done := make(chan struct{})
	var out []byte
	var err error
	go func() {
		out, err = cmd.Output()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		_ = cmd.Process.Kill()
		return "", fmt.Errorf("shell %s did not produce a PATH within 10s -- a login profile may be hanging", shell)
	}
	if err != nil {
		return "", fmt.Errorf("running %s -l failed: %w", shell, err)
	}
	path := strings.TrimSpace(string(out))
	if path == "" {
		return "", fmt.Errorf("shell %s returned an empty PATH", shell)
	}
	return path, nil
}
