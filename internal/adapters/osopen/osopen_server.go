//go:build server

package osopen

import "errors"

// ErrUnsupportedInServerMode is returned by Open/Reveal in server
// mode -- there is no OS file manager to shell out to regardless of
// platform, same reasoning as internal/adapters/notify's own server
// stub.
var ErrUnsupportedInServerMode = errors.New("opening a file in the OS file manager is not available in server mode")

// Open always fails in server mode; see ErrUnsupportedInServerMode.
func Open(_ string) error { return ErrUnsupportedInServerMode }

// Reveal always fails in server mode; see ErrUnsupportedInServerMode.
func Reveal(_ string) error { return ErrUnsupportedInServerMode }
