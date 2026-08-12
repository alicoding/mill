//go:build server

package notify

import "errors"

// ErrUnsupportedInServerMode is returned by Start in server mode --
// there is no OS notification center to register against regardless of
// platform, same reasoning as internal/adapters/hotkey's own server
// stub (docs/SPEC.md §1.3).
var ErrUnsupportedInServerMode = errors.New("OS notifications are not available in server mode")

// Start always fails in server mode; see ErrUnsupportedInServerMode.
func Start() error { return ErrUnsupportedInServerMode }

// OnResponse is a no-op in server mode -- nothing ever calls callback.
func OnResponse(_ func(Response)) {}

// SendActionable is a no-op in server mode.
func SendActionable(_, _, _ string) error { return ErrUnsupportedInServerMode }

// SendPlain is a no-op in server mode.
func SendPlain(_, _, _ string) error { return ErrUnsupportedInServerMode }
