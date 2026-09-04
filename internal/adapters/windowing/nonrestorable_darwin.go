//go:build darwin && !server

package windowing

// framework-api-audit: wails/v3@v3.0.0-beta.12 lacks any window-restoration option -- WebviewWindowOptions and MacWindow (pkg/application/webview_window_options.go) expose no restorable/restoration field, no call site sets NSWindow's setRestorable: anywhere in the SDK, and application_darwin_delegate.m answers applicationSupportsSecureRestorableState: YES for every window the app owns.

/*
#cgo CFLAGS: -mmacosx-version-min=10.13 -x objective-c
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
