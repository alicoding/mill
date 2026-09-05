//go:build darwin && !server

package windowing

// framework-api-audit: wails/v3@v3.0.0-beta.15 lacks any macOS screen-lock or fast-user-switching event -- events.Common.ScreenLocked/ScreenUnlocked are mapped only by the iOS and Android backends (pkg/application/events_common_ios.go, events_common_android.go), events_common_darwin.go maps sleep and theme alone, and no NSWorkspaceSessionDidResignActiveNotification or com.apple.screenIsLocked observer exists anywhere in the SDK.

/*
#cgo CFLAGS: -mmacosx-version-min=10.13 -x objective-c
#cgo LDFLAGS: -framework Foundation -framework AppKit

#include "locktriggers_darwin.h"
*/
import "C"

import (
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

//export millLockTriggerFired
func millLockTriggerFired(code C.int) {
	var t LockTrigger
	switch int(code) {
	case C.MILL_LOCK_TRIGGER_SCREEN_LOCK:
		t = LockTriggerScreenLock
	case C.MILL_LOCK_TRIGGER_USER_SWITCH:
		t = LockTriggerUserSwitch
	default:
		return
	}
	// The caller is an AppKit notification block on the OS main thread
	// (locktriggers_darwin.m registers on the main queue), so the
	// subscriber -- which locks a vault, writes a file and emits an
	// event -- must never run inline: that would block the run loop
	// mid-notification. Hop onto a goroutine first, the same boundary
	// millFilePromiseDropped keeps.
	go emitLockTrigger(t)
}

// attachNativeLockTriggers installs the screen-lock and user-switch
// observers.
//
// The NATIVE registration is deferred to the window's first
// RuntimeReady event for the same reason AttachFilePromiseReceiver
// defers its own: this runs from the composition root BEFORE
// app.Run(), and InvokeSync before the run loop exists dereferences
// the toolkit's not-yet-initialized dispatcher.
func (win *Window) attachNativeLockTriggers() {
	var once sync.Once
	win.w.OnWindowEvent(events.Common.WindowRuntimeReady, func(*application.WindowEvent) {
		once.Do(func() {
			runMainThreadAction("windowing.Window.attachNativeLockTriggers", func() {
				C.millStartLockTriggers()
			})
		})
	})
}
