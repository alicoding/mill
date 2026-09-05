package windowing

import (
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// LockTrigger names an OS moment that means "the person walked away
// from this Mac, or put it out of reach" -- the events a vault lock
// policy can be hung on, beyond the idle timer. One port, four values:
// a consumer subscribes once and decides for itself which of them its
// own policy acts on, rather than each source growing its own hook.
type LockTrigger string

const (
	// LockTriggerSleep -- the Mac is about to sleep.
	LockTriggerSleep LockTrigger = "sleep"
	// LockTriggerScreenLock -- the screen was locked.
	LockTriggerScreenLock LockTrigger = "screenLock"
	// LockTriggerUserSwitch -- this login session stopped being the
	// active one because another user was switched to.
	LockTriggerUserSwitch LockTrigger = "userSwitch"
	// LockTriggerMinimize -- Mill's own main window was minimized.
	LockTriggerMinimize LockTrigger = "minimize"
)

// lockTriggerFn holds the one registered subscriber. A package var,
// not per-window state, for the same reason promiseDropFn is one:
// these are app-wide OS notifications, and only the main window is
// ever wired.
var (
	lockTriggerMu sync.Mutex
	lockTriggerFn func(LockTrigger)
)

// emitLockTrigger delivers t to the registered subscriber, if any.
//
// THREAD CONTRACT. Two of the four sources reach here on a goroutine
// Wails made for the handler (pkg/application/application.go's event
// pumps dispatch `go handleApplicationEvent` / `go handleWindowEvent`
// per event, never the main thread), and two reach here from an
// AppKit notification block running ON the OS main thread. This
// function therefore promises the subscriber nothing about its
// thread; the native side is what must not block, and it hops onto a
// goroutine before calling in (locktriggers_darwin.go).
func emitLockTrigger(t LockTrigger) {
	lockTriggerMu.Lock()
	fn := lockTriggerFn
	lockTriggerMu.Unlock()
	if fn == nil {
		return
	}
	fn(t)
}

// WireLockTriggers registers fn to receive every LockTrigger this
// build can observe, and subscribes the sources. One subscriber
// app-wide; the last registration wins. Called once from the
// composition root.
//
// WHAT COMES FROM THE TOOLKIT AND WHAT DOES NOT (audited against the
// pinned SDK, see locktriggers_darwin.go's own audit line):
//   - Sleep is the toolkit's: events.Common.SystemWillSleep, which the
//     darwin backend maps from events.Mac.ApplicationWillSleep, itself
//     an NSWorkspaceWillSleepNotification observer the SDK installs
//     (pkg/application/application_darwin.go).
//   - Minimize is the toolkit's, but only under its Mac name:
//     events.Common.WindowMinimise is emitted by the Linux backend
//     alone, while the darwin backend emits EventWindowDidMiniaturize
//     (pkg/application/webview_window_darwin.m), i.e.
//     events.Mac.WindowDidMiniaturize. Both are registered so the
//     trigger is not silently dead on either backend -- an event a
//     backend never emits costs one unused listener.
//   - Screen lock and user switch are NOT the toolkit's on macOS at
//     all, and come from this package's own observers instead.
//
// A build with no live application (headless `go test`, server mode)
// subscribes nothing: fn is remembered so a synthetic trigger can
// still be delivered in a test, and no OS source exists to fire it.
func (win *Window) WireLockTriggers(fn func(LockTrigger)) {
	lockTriggerMu.Lock()
	lockTriggerFn = fn
	lockTriggerMu.Unlock()
	if !Available() {
		return
	}
	application.Get().Event.OnApplicationEvent(events.Common.SystemWillSleep, func(*application.ApplicationEvent) {
		emitLockTrigger(LockTriggerSleep)
	})
	minimised := func(*application.WindowEvent) { emitLockTrigger(LockTriggerMinimize) }
	win.w.OnWindowEvent(events.Common.WindowMinimise, minimised)
	win.w.OnWindowEvent(events.Mac.WindowDidMiniaturize, minimised)
	win.attachNativeLockTriggers()
}
