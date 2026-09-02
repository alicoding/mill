package osopen

import "errors"

// ErrUnsupportedInServerMode is what Open/Reveal return in a server
// build, where there is no desktop to open anything on. Declared
// outside the build tags so a desktop caller can name it in a test
// or a branch (pluginsvc maps it to "approved, not performed").
var ErrUnsupportedInServerMode = errors.New("opening files or URLs is unsupported in server mode")
