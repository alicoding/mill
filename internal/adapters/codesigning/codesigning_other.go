//go:build !darwin || server

package codesigning

// EnsureIdentity always fails: server-mode builds and non-darwin
// desktop builds have no macOS keychain/codesign to manage.
func EnsureIdentity() (Identity, error) {
	return Identity{}, ErrUnsupportedPlatform
}

// SignBundle always fails, for the same reason.
func SignBundle(_ string) error {
	return ErrUnsupportedPlatform
}
