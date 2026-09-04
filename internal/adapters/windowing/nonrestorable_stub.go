//go:build !darwin || server

package windowing

import "unsafe"

// setNativeNonRestorable is a no-op outside a real desktop darwin
// build: window restoration is an AppKit feature, and server mode has
// no native windows at all (mainthread.go's Available() guard).
func setNativeNonRestorable(unsafe.Pointer) {}
