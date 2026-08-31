//go:build !darwin || server

package windowing

// AttachFilePromiseReceiver is a no-op off macOS and in server mode --
// file-promise drags are an AppKit-only construct, and server mode has
// no native window to attach to (filepromise_darwin.go carries the
// real implementation and the design's own reasoning).
func (win *Window) AttachFilePromiseReceiver(fn func(paths []string, x, y int)) {}
