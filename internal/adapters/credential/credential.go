// Package credential wraps zalando/go-keyring behind Mill's own names,
// per CLAUDE.md's ports/adapters rule. Already named as the pick for
// Configure's Integration/Connector secrets in docs/SPEC.md §3.5 (MIT, no
// cgo, macOS backend shells out to /usr/bin/security -- same shape as
// internal/adapters/clipboard, not a new kind of dependency) before this
// adapter existed to wrap it. Delegates to the OS's own already-present
// keychain (Keychain on macOS, Credential Manager on Windows, Secret
// Service on Linux) rather than hand-rolling a vault.
package credential

import "github.com/zalando/go-keyring"

// service namespaces every secret this adapter ever stores under one
// keychain "service" name, with the connector's own ID as the per-secret
// "user" -- so a Keychain inspection (Keychain Access.app, `security
// find-generic-password`) shows every Mill connector secret grouped
// under one recognizable entry, not scattered under ad hoc names.
const service = "mill-connector"

// ErrNotFound is go-keyring's own not-found sentinel, re-exported so
// callers can errors.Is against it without importing the underlying
// library themselves (the ports/adapters boundary this package exists
// for).
var ErrNotFound = keyring.ErrNotFound

// Store is Mill's own secret-storage interface -- the same
// callers-depend-on-the-interface-not-the-concrete-type shape
// internal/adapters/settings.Store already established. Unlike that
// package, go-keyring exposes its Set/Get/Delete as bare package
// functions rather than methods on a struct, so there's no existing
// concrete type to satisfy this structurally; keyringStore below is a
// small adapter type that exists solely to give those functions a
// method set.
type Store interface {
	// Set stores (or overwrites) connectorID's secret.
	Set(connectorID, secret string) error
	// Get retrieves connectorID's secret. Returns keyring.ErrNotFound
	// (unwrapped, so callers can compare with errors.Is) if none is
	// stored.
	Get(connectorID string) (string, error)
	// Delete removes connectorID's secret, if any.
	Delete(connectorID string) error
}

// keyringStore is Store's real, zalando/go-keyring-backed implementation.
type keyringStore struct{}

// New returns the real, OS-keychain-backed Store. Zero-argument and
// stateless (keyringStore carries no fields) since go-keyring itself is
// package-function-based with no client/handle to hold -- New exists so
// callers depend on the Store interface, not this package's functions
// directly, matching settings.New's own shape.
func New() Store {
	return keyringStore{}
}

func (keyringStore) Set(connectorID, secret string) error {
	return keyring.Set(service, connectorID, secret)
}

func (keyringStore) Get(connectorID string) (string, error) {
	return keyring.Get(service, connectorID)
}

func (keyringStore) Delete(connectorID string) error {
	return keyring.Delete(service, connectorID)
}
