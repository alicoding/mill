package settingssvc

import "github.com/alicoding/mill/internal/adapters/windowing"

// Presence -- "what should currently be on screen" -- had five scattered
// owners before goal 0188 slice 2: 14 window-level Show/Hide/Focus/
// Restore calls and 5 app-level ShowApp/HideApp/Quit calls across this
// package and main.go, plus two declarative AppKit option blocks
// (windowing.MacAppOptions in internal/adapters/windowing/archetype.go,
// and Hidden/HideOnFocusLost/HideOnEscape in auxwindows.go) that fire
// with no Go code running at all. Four separately-correct changes each
// wrote their own answer because nothing tied the pieces together
// (docs/goals/0188-presence-has-no-owner.md has the full measurement).
//
// This file is that tie: every "make a window visible" call in the
// package funnels through bringMainToFront or bringFloatingToFront
// below (the one documented exception, showApprovalPrompt's deliberate
// Show-only sequence, calls windowing.ShowApp() directly and says why).
// The "hide" side was already unified by goal 0182's
// yieldFocusIfMainHidden (settingsservice_panel.go) -- the ONE place
// that decides whether nothing of Mill is left on screen and, if so,
// hides the whole app; every dismiss path (DismissPanel,
// DismissApprovalPrompt, the panel's own OnLostFocus listener) already
// calls it rather than hiding the app itself. windowing.Quit() is the
// sole termination call Mill's own code makes (SettingsService.QuitApp,
// main.go's tray Quit item) -- the invariant windowing.MacAppOptions'
// own doc comment states and archetype_test.go pins: Mill terminates
// only on an explicit user Quit, never as a side effect of a window
// becoming invisible.
//
// A cold reader tracing "what happens when Mill needs to be visible"
// starts here; tracing "what happens when the last window closes or
// the app is asked to quit" starts at windowing.MacAppOptions
// (internal/adapters/windowing/archetype.go) and the Hidden/
// HideOnFocusLost/HideOnEscape option blocks in auxwindows.go, both of
// which point back to this file.

// bringMainToFront is the ONLY way this package asks for the main
// window to become visible, un-minimized, and key. It always un-hides
// the app first: goal 0186 found that ShowWindow used to skip this
// step, so a caller reaching it while Mill was app-hidden (via
// windowing.HideApp -- e.g. the focus-yield mitigation above) was a
// silent no-op from the user's seat, because ordering a window in does
// not, by itself, reverse an app-level hide on macOS. windowing.ShowApp
// must run BEFORE the window-level calls: App-level Show doesn't
// reverse a window-level Hide either, so showing the window first would
// race a still-hidden app for who gets to draw it on screen.
func bringMainToFront(w *windowing.Window) {
	if w == nil {
		return
	}
	windowing.ShowApp()
	w.Show()
	w.Restore()
	w.Focus()
}

// bringFloatingToFront is the shared show sequence for Mill's two
// always-alive floating second windows (the Quick Panel, ADR-0033's own
// naming) -- same un-hide-first reasoning as bringMainToFront. Restore
// is deliberately omitted: neither floating window is ever minimized
// (DisableResize, no native minimize control in auxwindows.go's
// options), so calling it would be a meaningless no-op on this family,
// unlike the main window the OS lets the user actually minimize.
func bringFloatingToFront(w *windowing.Window) {
	if w == nil {
		return
	}
	windowing.ShowApp()
	w.Show()
	w.Focus()
}
