package windowing

import (
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

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

// WaitForEvent blocks until the named custom event arrives from any
// window or the timeout passes; it reports which. Used for the
// quit / restart handshake (goal 0295 S2): Go asks the page to flush
// its live edits and waits, bounded, for the page's answer. Never call
// on the main thread -- bound-method calls run on their own goroutine.
func WaitForEvent(name string, timeout time.Duration) bool {
	app := application.Get()
	if app == nil {
		return false
	}
	done := make(chan struct{}, 1)
	off := app.Event.On(name, func(*application.CustomEvent) {
		select {
		case done <- struct{}{}:
		default:
		}
	})
	defer off()
	select {
	case <-done:
		return true
	case <-time.After(timeout):
		return false
	}
}

// WaitForAnyEvent blocks until the first of the named custom events
// arrives from any window, or the timeout passes; it reports which
// event (and its payload) or ok=false on timeout / no live app. The
// leave handshake (settingssvc/settingsservice_flush.go) waits on two
// answers at once -- the page's "flushed" and its "held, a sheet is
// up". Never call on the main thread.
func WaitForAnyEvent(timeout time.Duration, names ...string) (name string, data any, ok bool) {
	app := application.Get()
	if app == nil {
		return "", nil, false
	}
	type arrival struct {
		name string
		data any
	}
	done := make(chan arrival, 1)
	for _, n := range names {
		n := n
		off := app.Event.On(n, func(ev *application.CustomEvent) {
			select {
			case done <- arrival{name: n, data: ev.Data}:
			default:
			}
		})
		defer off()
	}
	select {
	case a := <-done:
		return a.name, a.data, true
	case <-time.After(timeout):
		return "", nil, false
	}
}
