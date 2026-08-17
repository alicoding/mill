//go:build server

// Package osopen wraps the OS file-manager verbs (launch a path,
// select it in the file manager). This server-tag stub makes both
// no-op errors -- server mode has no OS file manager session, the
// same posture as the other native adapters' server stubs.
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
