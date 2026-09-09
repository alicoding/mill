//go:build darwin && !server

package windowing

// framework-api-audit: wails/v3@v3.0.0-beta.18 lacks an exported query of whether the calling goroutine is on the main thread right now -- mainthread.go exports InvokeSync/InvokeAsync to dispatch onto it, never a boolean read of current thread identity, which assertMainThread's runtime guard needs before it would dispatch at all.

/*
// -Wno-unused-parameter: see locktriggers_darwin.go's own comment --
// cgo's own generated GCC prolog for this package's //export functions
// merges every file's CFLAGS together, so the flag is repeated on each
// file rather than relying on declaration order to keep it last.
#cgo CFLAGS: -x objective-c -Wall -Wextra -Werror -Wno-unused-parameter
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
