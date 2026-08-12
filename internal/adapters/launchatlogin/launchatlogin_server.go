//go:build server

package launchatlogin

// Enable always fails in server mode; see ErrUnsupportedInServerMode.
func Enable(_ string) error {
	return ErrUnsupportedInServerMode
}

// Disable always fails in server mode; see ErrUnsupportedInServerMode.
func Disable(_ string) error {
	return ErrUnsupportedInServerMode
}

// IsEnabled always fails in server mode; see ErrUnsupportedInServerMode.
func IsEnabled(_ string) (bool, error) {
	return false, ErrUnsupportedInServerMode
}
