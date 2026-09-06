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

// OpenWith is the server stub of the open-app performer.
func OpenWith(_, _ string) error { return ErrUnsupportedInServerMode }

// OpenURL is the server stub of the URL opener -- no server build, the
// phone LaunchAgent included, has ever had a desktop browser to open a
// URL in; a link click there stays whatever the connecting device's own
// browser already renders it as, never a Go-side OS call.
func (h *Host) OpenURL(_ string) error { return ErrUnsupportedInServerMode }
