//go:build !server

package osopen

import "os/exec"

var openWithCmd = func(app, path string) *exec.Cmd { return exec.Command("open", "-a", app, path) } //nolint:gosec // an app name and a local path a plugin declared and the guardrail approved

// OpenWith opens path in the named application (Finder's "Open With"
// through `open -a`) -- the guarded open-app door's own performer.
func OpenWith(app, path string) error {
	return start(openWithCmd(app, path))
}
