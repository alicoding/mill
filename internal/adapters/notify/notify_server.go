//go:build server

package notify

// there is no OS notification center to register against regardless of
// platform, same reasoning as internal/adapters/hotkey's own server
// stub (docs/SPEC.md §1.3).

// Start always fails in server mode; see ErrUnsupportedInServerMode.
func Start() error { return ErrUnsupportedInServerMode }

// OnResponse is a no-op in server mode -- nothing ever calls callback.
func OnResponse(_ func(Response)) {}

// SendActionable is a no-op in server mode.
func SendActionable(_, _, _ string) error { return ErrUnsupportedInServerMode }

// SendPlain is a no-op in server mode.
func SendPlain(_, _, _ string) error { return ErrUnsupportedInServerMode }
