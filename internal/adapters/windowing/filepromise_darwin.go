//go:build darwin && !server

package windowing

// framework-api-audit: wails/v3@v3.0.0-beta.15 lacks any drag-OUT file-promise API -- webview_window_darwin_drag.m only registerForDraggedTypes to receive drops; no NSFilePromiseProvider/NSDraggingSource wrapper exists on any platform.

/*
#cgo CFLAGS: -mmacosx-version-min=10.13 -x objective-c
#cgo LDFLAGS: -framework Foundation -framework AppKit

#include "filepromise_darwin.h"
*/
import "C"

import (
	"sync"
	"unsafe"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// promiseDropFn holds the one registered promise-drop callback -- a
// package var, not per-window state, since only the main window is
// ever wired (the same singular-resource shape clipboard's own
// selfWriteText carries).
var (
	promiseDropMu sync.Mutex
	promiseDropFn func(paths []string, x, y int)
)

//export millFilePromiseDropped
func millFilePromiseDropped(paths **C.char, count C.int, x C.int, y C.int) {
	n := int(count)
	goPaths := make([]string, 0, n)
	for _, p := range unsafe.Slice(paths, n) {
		goPaths = append(goPaths, C.GoString(p))
	}
	promiseDropMu.Lock()
	fn := promiseDropFn
	promiseDropMu.Unlock()
	if fn == nil {
		return
	}
	// The caller is a GCD completion block, not a Go-owned thread --
	// hop onto a goroutine so the callback can do arbitrary Go work
	// (event emits, service calls) without holding the C side.
	go fn(goPaths, int(x), int(y))
}

// AttachFilePromiseReceiver installs the file-promise drop view on
// win and registers fn to receive each materialized drop's temp-file
// paths plus the drop point (top-left webview coordinates, matching
// the toolkit's own file-drop event). One callback app-wide; the last
// registration wins. See filepromise_darwin.m's own view comment for
// why this cannot interfere with ordinary file drops.
//
// The NATIVE attach is deferred to the window's first RuntimeReady
// event: this method is called from main.go's wiring, BEFORE
// app.Run() -- and InvokeSync before the run loop exists dereferences
// the toolkit's not-yet-initialized dispatcher (a launch-time SIGSEGV,
// reproduced live). RuntimeReady fires only once the app is running,
// so the marshal inside is always legal by construction.
func (win *Window) AttachFilePromiseReceiver(fn func(paths []string, x, y int)) {
	promiseDropMu.Lock()
	promiseDropFn = fn
	promiseDropMu.Unlock()
	var once sync.Once
	win.w.OnWindowEvent(events.Common.WindowRuntimeReady, func(*application.WindowEvent) {
		once.Do(func() {
			runMainThreadAction("AttachFilePromiseReceiver", func() {
				// NativeWindow is a stored-pointer read (nil when the
				// window is destroyed -- the C side guards nil).
				C.millAttachPromiseView(win.w.NativeWindow())
			})
		})
	})
}
