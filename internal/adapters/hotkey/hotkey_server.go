//go:build server

package hotkey

import "errors"

// ErrUnsupportedInServerMode is returned by Bind in server mode: there is
// no native run loop (Cocoa/X11/Win32 message pump) in that mode to
// deliver keypresses through, so global hotkeys can never work there
// regardless of permissions -- this is not a missing feature, it's a
// documented gap (see docs/SPEC.md §1.3 and ADR-0002).
var ErrUnsupportedInServerMode = errors.New("global hotkeys are not available in server mode (no native run loop)")

// Binding is a no-op placeholder in server mode.
type Binding struct{}

// Bind always fails in server mode; see ErrUnsupportedInServerMode.
func Bind(_ []string, _ string) (*Binding, error) {
	return nil, ErrUnsupportedInServerMode
}

// Unbind is a no-op in server mode.
func (b *Binding) Unbind() error {
	return nil
}

// Keydown never fires in server mode.
func (b *Binding) Keydown() <-chan struct{} {
	return nil
}
