//go:build server

// Package osopen wraps the OS file-manager verbs (launch a path,
// select it in the file manager). This server-tag stub makes both
// no-op errors -- server mode has no OS file manager session, the
// same posture as the other native adapters' server stubs.
package osopen

// Open always fails in server mode; see ErrUnsupportedInServerMode.
func Open(_ string) error { return ErrUnsupportedInServerMode }

// Reveal always fails in server mode; see ErrUnsupportedInServerMode.
func Reveal(_ string) error { return ErrUnsupportedInServerMode }
