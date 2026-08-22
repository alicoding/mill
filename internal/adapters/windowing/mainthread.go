// Package windowing is the sole port onto
// github.com/wailsapp/wails/v3/pkg/application (.claude/rules/
// architecture.md's adopted-library boundary): every call a service
// package needs against the live desktop app -- showing/hiding
// windows, emitting events, native dialogs, the application menu --
// goes through this package instead of importing the toolkit directly.
// depguard (.golangci.yml) denies that import everywhere except here
// and the root main package, new-code-scoped (docs/goals/0168).
//
// The reason this boundary exists is not just import hygiene: Wails3's
// App-level Show/Hide/Quit perform raw cgo calls straight into AppKit
// with no main-thread marshal of their own (unlike a *WebviewWindow's
// own methods, which already marshal internally) -- confirmed against
// the pinned SDK source, application_darwin.go's (*macosApp).show/hide
// call C.show()/C.hide() directly. AppKit aborts the process if
// touched off the main thread. runMainThreadAction is the ONE place
// that dispatch happens; assertMainThread (assert.go) is a runtime
// self-check that the dispatch actually landed on the real OS main
// thread, not just Go-level bookkeeping.
package windowing

import "github.com/wailsapp/wails/v3/pkg/application"

// Available reports whether a live Wails application exists --
// false under a headless `go test` (no application.New() was ever
// called) or before startup has reached that point. Every function in
// this package that touches application.Get() degrades to a safe
// no-op/zero-value when this is false, the same guard every migrated
// call site already carried before moving here.
func Available() bool {
	return application.Get() != nil
}

// runMainThreadAction executes fn as a marshaled App-level platform
// call: a no-op skip when no live app exists (headless/test -- no
// AppKit run loop, no thread rule to enforce), otherwise always
// dispatched through application.InvokeSync with assertMainThread
// checked first inside the dispatched closure. This is the single
// dispatch point that retires the per-call `mainThreadRun` seam
// settingssvc used to carry itself (docs/goals/0168 item 5): callers
// never need to know or remember whether a live app exists yet, they
// just call the public wrapper (ShowApp, HideApp, ...) and get correct
// behavior either way.
func runMainThreadAction(callSite string, fn func()) {
	if !Available() {
		return
	}
	application.InvokeSync(func() {
		assertMainThread(callSite)
		fn()
	})
}
