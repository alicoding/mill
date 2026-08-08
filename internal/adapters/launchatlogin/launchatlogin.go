// Package launchatlogin toggles whether Mill starts automatically when
// the user logs in. Wails v3 has no official mechanism for this
// (confirmed directly against the current wailsapp/wails repo before
// writing this: a PR proposing one, #3910, was closed unmerged, and a
// pkg.go.dev hit for a v3/plugins/start_at_login package is a false
// positive -- no such directory exists in the repo, it's an artifact of
// that abandoned PR's branch). Wails v2 did ship a real one
// (v2/pkg/mac/login_darwin.go): shell out to osascript/System Events --
// the same shape internal/adapters/clipboard already uses for its own
// macOS clipboard I/O, ported here rather than reinvented.
//
// Split by !server/server build tag, same shape and same reasoning as
// internal/adapters/hotkey: server mode has no login-item concept to
// register against regardless of OS (docs/SPEC.md §1.3).
package launchatlogin

import "errors"

// ErrNotAppBundle is returned when the running binary isn't a real
// .app bundle (e.g. a bare `go run`/`task dev` binary) -- System
// Events' login-item mechanism registers an application bundle path,
// not an arbitrary executable, so this is a real, user-facing
// limitation to surface plainly rather than silently no-op.
var ErrNotAppBundle = errors.New("launch at login requires a built .app bundle, not a dev binary")

// ErrUnsupportedInServerMode is returned by every function in server
// mode -- there is no login-item concept in that mode regardless of OS.
var ErrUnsupportedInServerMode = errors.New("launch at login is not available in server mode")
