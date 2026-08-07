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

// Set stores (or overwrites) connectorID's secret.
func Set(connectorID, secret string) error {
	return keyring.Set(service, connectorID, secret)
}

// Get retrieves connectorID's secret. Returns keyring.ErrNotFound
// (unwrapped, so callers can compare with errors.Is) if none is stored.
func Get(connectorID string) (string, error) {
	return keyring.Get(service, connectorID)
}

// Delete removes connectorID's secret, if any.
func Delete(connectorID string) error {
	return keyring.Delete(service, connectorID)
}
