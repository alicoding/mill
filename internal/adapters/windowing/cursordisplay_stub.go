//go:build !darwin || server

package windowing

// CursorDisplayID always reports not-found outside a real desktop
// darwin build: cursor-to-display resolution is an AppKit query, and
// server mode has no attached screens at all (mainthread.go's
// Available() guard covers the same headless case for every other
// App-level call this package makes).
func CursorDisplayID() (id string, ok bool) {
	return "", false
}
