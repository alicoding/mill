// Package hotkey wraps golang.design/x/hotkey behind Mill's own names, per
// CLAUDE.md's ports/adapters rule for commodity libraries. Callers work in
// plain string modifier/key names ("cmd", "shift", "M") and never import
// the underlying library directly. The real implementation only builds for
// desktop mode (hotkey_desktop.go); server mode gets a stub (hotkey_server.go)
// since there's no native run loop to deliver keypresses through, and the
// real library's Linux backend needs cgo + X11 dev headers Wails3's own
// server mode is specifically designed to avoid requiring.
package hotkey

import "errors"

// ErrRegisterFailed distinguishes an OS-level registration failure (wrong
// permission, combo already taken) from a caller passing an unrecognized
// key/modifier name — callers use errors.Is to add permission-specific
// guidance only for this case, not for a plain bad-input error.
var ErrRegisterFailed = errors.New("hotkey registration failed")
