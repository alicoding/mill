//go:build server

package launchatlogin

// Enable always fails in server mode; see ErrUnsupportedInServerMode.
func Enable(execPath string) error {
	return ErrUnsupportedInServerMode
}

// Disable always fails in server mode; see ErrUnsupportedInServerMode.
func Disable(execPath string) error {
	return ErrUnsupportedInServerMode
}

// IsEnabled always fails in server mode; see ErrUnsupportedInServerMode.
func IsEnabled(execPath string) (bool, error) {
	return false, ErrUnsupportedInServerMode
}
