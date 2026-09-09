//go:build darwin && !server

package windowing

// framework-api-audit: wails/v3@v3.0.0-beta.18 lacks any window-restoration option -- WebviewWindowOptions and MacWindow (pkg/application/webview_window_options.go) expose no restorable/restoration field, no call site sets NSWindow's setRestorable: anywhere in the SDK, and application_darwin_delegate.m answers applicationSupportsSecureRestorableState: YES for every window the app owns.

/*
// -Wno-unused-parameter: see locktriggers_darwin.go's own comment --
// cgo's own generated GCC prolog for this package's //export functions
// merges every file's CFLAGS together, so the flag is repeated on each
// file rather than relying on declaration order to keep it last.
#cgo CFLAGS: -x objective-c -Wall -Wextra -Werror -Wno-unused-parameter
#cgo LDFLAGS: -framework Foundation -framework AppKit

#include "Foundation/Foundation.h"
#include "AppKit/AppKit.h"

static void millSetWindowNonRestorable(void *nsWindow) {
	if (nsWindow == NULL) {
		return;
	}
	[(NSWindow *)nsWindow setRestorable:NO];
}
*/
import "C"

import "unsafe"

// setNativeNonRestorable clears NSWindow.restorable on a live native
// window: AppKit encodes every restorable window that is on screen when
// the process ends and puts it back at the next launch, which is what
// put Mill's floating windows on screen after a relaunch (docs/goals/
// 0344). Must run on the main thread -- AppKit window state is
// main-thread-only, so every caller goes through runMainThreadAction.
func setNativeNonRestorable(handle unsafe.Pointer) {
	C.millSetWindowNonRestorable(handle)
}
