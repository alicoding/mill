//go:build darwin && !server

package windowing

/*
#cgo CFLAGS: -mmacosx-version-min=10.13 -x objective-c
#cgo LDFLAGS: -framework Foundation -framework AppKit

#include "filepromise_darwin.h"
*/
import "C"

import (
	"sync"
	"unsafe"
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
func (win *Window) AttachFilePromiseReceiver(fn func(paths []string, x, y int)) {
	promiseDropMu.Lock()
	promiseDropFn = fn
	promiseDropMu.Unlock()
	runMainThreadAction("AttachFilePromiseReceiver", func() {
		// NativeWindow is a stored-pointer read (nil when the window
		// is destroyed or not yet realized -- the C side guards nil);
		// read inside the marshal so the attach sees the freshest
		// window state.
		C.millAttachPromiseView(win.w.NativeWindow())
	})
}
