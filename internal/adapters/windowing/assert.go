package windowing

import "log/slog"

// assertMainThread is the JavaFX-style guard (docs/goals/0168, owner-
// ratified): every App-level platform call in this package runs it
// immediately before touching the real AppKit/App method, from inside
// the main-thread-dispatched closure (see runMainThreadAction). A pass
// means the marshal actually landed where it promised to; a violation
// means some call in this package reached the platform without going
// through the marshal -- callSite names which one, for both the panic
// message and the release-mode log line.
func assertMainThread(callSite string) {
	reportThreadViolation(isOnMainThread(), isReleaseBuild, callSite)
}

// reportThreadViolation is assertMainThread's pure decision core,
// extracted so both branches are unit-testable without depending on a
// real build tag (isReleaseBuild is fixed per binary, so a single test
// process can never observe both halves through assertMainThread
// itself) or a real cgo thread check. onMainThread=false is the only
// case that does anything: dev/test builds panic (impossible to ship
// unnoticed), release builds log the call site and return -- the
// caller has already gone through application.InvokeSync by the time
// this runs (runMainThreadAction), so the call itself still completes
// correctly either way; this only decides how loudly the miss is
// reported.
func reportThreadViolation(onMainThread, release bool, callSite string) {
	if onMainThread {
		return
	}
	if release {
		slog.Error("windowing: platform call reached AppKit off the main thread", "call_site", callSite)
		return
	}
	panic("windowing: " + callSite + " reached AppKit off the main thread")
}
