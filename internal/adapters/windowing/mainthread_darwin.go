//go:build darwin && !server

package windowing

/*
#cgo CFLAGS: -mmacosx-version-min=10.13 -x objective-c
#cgo LDFLAGS: -framework Foundation

#include "Foundation/Foundation.h"

static bool onMainThread() {
	return [NSThread isMainThread];
}
*/
import "C"

// isOnMainThread reports whether the calling goroutine is currently
// running on the real OS main thread, via the same [NSThread
// isMainThread] check Wails3's own dispatcher uses internally
// (pkg/application/mainthread_darwin.go, unexported there) -- the
// ground truth assertMainThread checks against, not Go-level
// bookkeeping of "did a caller go through the marshal."
func isOnMainThread() bool {
	return bool(C.onMainThread())
}
