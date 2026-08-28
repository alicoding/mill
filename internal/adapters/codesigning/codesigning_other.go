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

// TrustIdentity always fails, for the same reason.
func TrustIdentity() error {
	return ErrUnsupportedPlatform
}

// IsTrusted always fails, for the same reason: there is no signing
// concept to have trusted anything on this platform.
func IsTrusted() (bool, error) {
	return false, ErrUnsupportedPlatform
}
