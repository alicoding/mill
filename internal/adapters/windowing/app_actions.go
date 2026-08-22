package windowing

import "github.com/wailsapp/wails/v3/pkg/application"

// ShowApp activates the whole app (application.App-level Show, as
// opposed to a single window's own Show) -- always main-thread
// marshaled and asserted (mainthread.go). Used to bring Mill frontmost
// before showing a floating window, since App-level Show doesn't
// reverse a window-level Hide on its own.
func ShowApp() {
	runMainThreadAction("windowing.ShowApp", func() {
		if app := application.Get(); app != nil {
			app.Show()
		}
	})
}

// HideApp hides the whole app -- the focus-yield mitigation's own call
// (nothing of Mill's is left on screen to justify staying frontmost).
// Always main-thread marshaled and asserted.
func HideApp() {
	runMainThreadAction("windowing.HideApp", func() {
		if app := application.Get(); app != nil {
			app.Hide()
		}
	})
}

// Quit terminates the running app -- a no-op with no live app (headless
// test, or a caller racing shutdown). App.Quit() itself is safe off the
// main thread (confirmed against the pinned SDK source: it only
// signals the run loop to stop, no direct AppKit touch), so this
// doesn't route through runMainThreadAction.
func Quit() {
	if app := application.Get(); app != nil {
		app.Quit()
	}
}

// Emit sends a named app-level event with payload to every window --
// a no-op with no live app (headless test). Wails3's own Event.Emit is
// safe from any goroutine (it queues onto each window's own dispatch),
// so this doesn't need the main-thread marshal either.
func Emit(name string, payload any) {
	if app := application.Get(); app != nil {
		app.Event.Emit(name, payload)
	}
}
