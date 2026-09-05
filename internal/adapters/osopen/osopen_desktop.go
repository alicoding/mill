//go:build !server

// Package osopen wraps the two distinct OS file-manager verbs Atlas's
// card context menu needs (goal 0081 slice A4): launching a path with
// its default application, and selecting it in the file manager
// without opening it. Wails3's own BrowserManager.OpenFile (internal/
// browser, macOS `open <path>`) already covers the first; there is no
// equivalent for the second (select-in-place, macOS `open -R <path>`)
// anywhere in this codebase or the Wails3 SDK, so this package adds
// it, same shape as every other native adapter (notify, hotkey,
// idletime): a desktop build backed by a real OS command, a server
// build that always errors (no file manager exists headless).
package osopen

import (
	"os/exec"

	"github.com/alicoding/mill/internal/adapters/windowing"
)

// openCmd/revealCmd are package vars (not called directly) so a test
// can substitute a non-side-effecting exec.Cmd -- same seam Wails3's
// own internal/browser package uses for its equivalent openCmd var.
var openCmd = func(path string) *exec.Cmd { return exec.Command("open", path) }         //nolint:gosec // a card's own MirrorPath, a local filesystem path Mill itself resolved, not external input
var revealCmd = func(path string) *exec.Cmd { return exec.Command("open", "-R", path) } //nolint:gosec // same MirrorPath, by design

// Open launches path with the OS default application for its file
// type (macOS `open <path>`).
func Open(path string) error {
	return start(openCmd(path))
}

// Reveal selects path in the OS file manager without opening it
// (macOS `open -R <path>`) -- distinct from Open: the file stays
// closed, only highlighted in its containing folder.
func Reveal(path string) error {
	return start(revealCmd(path))
}

func start(cmd *exec.Cmd) error {
	if err := cmd.Start(); err != nil {
		return err
	}
	go cmd.Wait() //nolint:errcheck
	return nil
}

// OpenURL opens url in the system's default browser, through Wails'
// own Browser.OpenURL (internal/adapters/windowing.OpenURL, the sole
// port onto pkg/application) rather than this file's own Open/Reveal
// exec path -- the adopted runtime already owns "open a URL", the
// highest abstraction available on desktop.
func (h *Host) OpenURL(url string) error {
	return windowing.OpenURL(url)
}
