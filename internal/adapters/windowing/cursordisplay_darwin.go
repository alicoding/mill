//go:build darwin && !server

package windowing

// framework-api-audit: wails/v3@v3.0.0-beta.15 lacks a cursor-location / lastClickedScreen API -- macosSystemTray.lastClickedScreen
// (pkg/application/systemtray_darwin.go) is unexported and never
// surfaced, and screen_darwin.go's getScreenForSystemTray/
// getScreenForWindow read a WINDOW's own screen, never the cursor's.
// Revisit when Wails passes lastClickedScreen into
// systemTrayPositionWindow upstream (goal 0417 decision 5).

/*
#cgo CFLAGS: -mmacosx-version-min=10.13 -x objective-c
#cgo LDFLAGS: -framework Foundation -framework AppKit

#include "Foundation/Foundation.h"
#include "AppKit/AppKit.h"

// millCursorDisplayID returns the NSScreenNumber of the NSScreen whose
// frame contains the current cursor location, 0 if the cursor is on no
// known screen. NSScreen.screens and NSEvent.mouseLocation are AppKit
// state Wails' own screen code documents as main-thread-only
// (pkg/application/screen_darwin.go's processAndCacheScreens: "NSScreen
// and other AppKit APIs are not thread-safe and must be accessed on the
// main thread") -- every Go caller dispatches through
// runMainThreadAction, never calls this off the main thread.
static unsigned int millCursorDisplayID() {
	NSPoint mouseLocation = [NSEvent mouseLocation];
	for (NSScreen *screen in [NSScreen screens]) {
		if (NSPointInRect(mouseLocation, [screen frame])) {
			NSDictionary *description = [screen deviceDescription];
			NSNumber *screenNumber = [description objectForKey:@"NSScreenNumber"];
			return [screenNumber unsignedIntValue];
		}
	}
	return 0;
}
*/
import "C"

import "strconv"

// CursorDisplayID returns the display ID of the screen the cursor is
// currently on, formatted the same way app.Screen's own Screen.ID is
// (pkg/application/screen_darwin.go's cScreenToScreen: "%u" of the
// CGDirectDisplayID) so the result plugs straight into
// app.Screen.GetByID. ok is false with no live app (runMainThreadAction
// skips fn, leaving raw at its zero value) or when the cursor sits on
// no known screen (id 0).
func CursorDisplayID() (id string, ok bool) {
	var raw C.uint
	runMainThreadAction("windowing.CursorDisplayID", func() {
		raw = C.millCursorDisplayID()
	})
	if raw == 0 {
		return "", false
	}
	return strconv.FormatUint(uint64(raw), 10), true
}
