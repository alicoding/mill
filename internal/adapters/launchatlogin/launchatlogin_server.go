//go:build server

package launchatlogin

import "github.com/wailsapp/wails/v3/pkg/application"

// Enable always fails in server mode; see ErrUnsupportedInServerMode.
func Enable(_ string) error {
	return ErrUnsupportedInServerMode
}

// Disable always fails in server mode; see ErrUnsupportedInServerMode.
func Disable(_ string) error {
	return ErrUnsupportedInServerMode
}

// Status always fails in server mode; see ErrUnsupportedInServerMode.
func Status(_ string) (LoginItemStatus, error) {
	return LoginItemDisabled, ErrUnsupportedInServerMode
}

// SetAutostartManager is a no-op in server mode -- there is no
// login-item concept to wire regardless of platform (docs/SPEC.md
// §1.3) -- but main.go calls it unconditionally right after
// application.New() returns, so this keeps that call site building
// under the server tag too.
func SetAutostartManager(_ *application.AutostartManager) {}
