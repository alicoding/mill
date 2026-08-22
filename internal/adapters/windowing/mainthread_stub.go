//go:build !darwin || server

package windowing

// isOnMainThread always reports true outside a real desktop darwin
// build: server mode has no AppKit run loop and no platform thread
// rule to violate (every App-level call this package makes degrades to
// a direct call there, mainthread.go's Available() guard), and Mill
// ships desktop-only on darwin (docs/SPEC.md §1.3) so no other GOOS
// ever reaches the real assertion either.
func isOnMainThread() bool {
	return true
}
