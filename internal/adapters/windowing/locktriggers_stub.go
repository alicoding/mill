//go:build !darwin || server

package windowing

// attachNativeLockTriggers is a no-op outside a real desktop darwin
// build: screen lock and fast user switching are AppKit workspace
// notifications, and server mode has no console session to observe
// them in.
func (win *Window) attachNativeLockTriggers() {}
