// Package launchatlogin toggles whether Mill starts automatically when
// the user logs in, backed by Wails v3's own AutostartManager
// (github.com/wailsapp/wails/v3/pkg/application, added since this
// package's original osascript/System-Events implementation was
// written). On darwin it registers through SMAppService (Apple's
// ServiceManagement framework, macOS 13+) rather than shelling out to
// osascript: SMAppService needs no Automation (TCC) permission, and
// unlike System Events it can report a registration macOS is still
// holding for the user's approval, distinct from one actually running.
//
// AutostartManager's own exported Status() does not surface that
// pending-approval bit, though -- read directly against the pinned
// module before writing this file (autostart_darwin.go,
// autostart_darwin_smappservice.go): its darwin implementation treats
// SMAppServiceStatusRequiresApproval the same as "SMAppService
// unavailable" and falls through to a LaunchAgent-plist check instead,
// which a bundled macOS-13+ app never has. Recovering that bit is this
// package's own narrow darwin-only call
// (launchatlogin_smappservice_darwin.go) -- the one piece of platform
// code AutostartManager's public surface genuinely does not offer.
//
// Split by !server/server build tag, same shape and same reasoning as
// internal/adapters/hotkey: server mode has no login-item concept to
// register against regardless of OS (docs/SPEC.md §1.3).
package launchatlogin

import "errors"

// ErrNotAppBundle is returned when the running binary isn't a real
// .app bundle (e.g. a bare `go run`/`task dev` binary) -- Mill only
// ever offers launch-at-login from an installed bundle, not an
// arbitrary executable, so this is a real, user-facing limitation to
// surface plainly rather than silently no-op.
var ErrNotAppBundle = errors.New("launch at login requires a built .app bundle, not a dev binary")

// ErrUnsupportedInServerMode is returned by every function in server
// mode -- there is no login-item concept in that mode regardless of OS.
var ErrUnsupportedInServerMode = errors.New("launch at login is not available in server mode")

// ErrAutostartNotWired is returned when Enable/Disable/Status run
// before main.go has called SetAutostartManager -- AutostartManager is
// bound to the running *application.App instance and doesn't exist
// before application.New() returns, so this guards a real (if narrow)
// ordering bug rather than a platform limitation.
var ErrAutostartNotWired = errors.New("launch at login: autostart manager not wired yet")

// LoginItemStatus is the tri-state Mill's Settings UI renders
// distinctly (goal 0198). RequiresApproval is neither Enabled nor
// Disabled: SMAppService accepted the registration, but macOS is
// holding it until the user explicitly confirms it in System Settings,
// and the login item does not actually run until they do.
type LoginItemStatus string

const (
	LoginItemDisabled         LoginItemStatus = "disabled"
	LoginItemEnabled          LoginItemStatus = "enabled"
	LoginItemRequiresApproval LoginItemStatus = "requires-approval"
)
