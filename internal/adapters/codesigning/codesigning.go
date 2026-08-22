// Package codesigning maintains Mill's own per-machine, self-signed
// code-signing identity and uses it to re-sign the app bundle right
// after a self-update. macOS keys Accessibility/Input-Monitoring
// grants to the running bundle's designated requirement; an ad-hoc
// signature's default DR is pinned to the build's cdhash, so every
// rebuild invalidates the grant. A certificate-signed bundle's default
// DR pins the certificate-leaf hash instead, which stays constant
// across rebuilds as long as the same identity keeps signing (Apple
// TN2206) -- docs/goals/archive/0158-stable-signing-identity.md.
package codesigning

import "errors"

// ErrUnsupportedPlatform is returned by every function on a non-darwin
// build and on every server-mode build: there is no macOS code-signing
// identity to manage in either case.
var ErrUnsupportedPlatform = errors.New("codesigning: unsupported on this platform")

// Identity names the local signing identity SignBundle uses.
type Identity struct {
	// Name is the certificate common name passed to `codesign -s`.
	Name string
	// SHA1 is the certificate's SHA-1 hash -- its keychain identifier,
	// and what stays identical across every EnsureIdentity call once
	// the identity exists (the idempotency this package's tests pin).
	SHA1 string
}
