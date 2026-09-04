// Package presencekey reads and deletes ONE legacy macOS keychain
// item: the vault master key as an earlier design stored it, wrapped in
// a kSecAttrAccessControl (kSecAccessControlUserPresence) object.
//
// It exists SOLELY to retire that item. The ACL never took effect:
// kSecAttrAccessControl is honoured only inside the data-protection
// keychain, which needs an application-identifier /
// keychain-access-groups entitlement, and these items are pinned to the
// legacy login keychain (kSecUseDataProtectionKeychain: NO) precisely
// because a build without that entitlement cannot use the other one. So
// the value reads back with no prompt, which is what makes the one-way
// migration in secretsvc possible at all, and why nothing in Mill
// creates such an item any more -- the unlock requirement is a
// LocalAuthentication gate instead (internal/adapters/localauth, goal
// 0330).
//
// darwin && !server only (presencekey_darwin.go). Every other build
// keeps readImpl/removeImpl at their default ErrUnsupported closures
// below; no such item can exist there to migrate.
package presencekey

import "errors"

// ErrUnsupported is returned by every function on a build that cannot
// manage presence-gated keychain items -- any non-darwin platform, or
// any server build regardless of OS (see package doc).
var ErrUnsupported = errors.New("presencekey: user-presence-protected keychain items are not available on this build")

// ErrNotFound is returned by Read when no item matches service/account.
var ErrNotFound = errors.New("presencekey: no matching keychain item")

// readImpl/removeImpl are swapped at package-init time by
// presencekey_darwin.go's own init() (real Security-framework calls) --
// left at these ErrUnsupported-returning defaults on every other build.
// This package's own tests swap them too, to exercise Read's
// goroutine/channel wrapping without touching cgo or the real keychain.
var (
	readImpl   = func(_, _, _ string) ([]byte, error) { return nil, ErrUnsupported }
	removeImpl = func(_, _ string) error { return ErrUnsupported }
)

// Remove deletes service/account's item. SecItemDelete matches on
// attributes only and never touches the protected value, so it never
// triggers an authentication prompt. Removing an item that doesn't
// exist is not an error (idempotent, matching the migration's own
// cleanup call site).
func Remove(service, account string) error {
	return removeImpl(service, account)
}

// readResult carries Read's own goroutine handoff.
type readResult struct {
	data []byte
	err  error
}

// Read returns service/account's stored value. SecItemCopyMatching
// blocks the calling thread whenever an item's ACL is actually
// enforced, so Read always runs it on a FRESH goroutine, never the
// caller's -- the item this package reads is one whose ACL is inert
// (see the package doc), but the call is written for the contract the
// API documents rather than for the behaviour one build happens to
// get. The result channel is buffered so that goroutine can always
// complete and exit even if a caller stops waiting on it.
func Read(service, account, prompt string) ([]byte, error) {
	ch := make(chan readResult, 1)
	go func() {
		data, err := readImpl(service, account, prompt)
		ch <- readResult{data, err}
	}()
	r := <-ch
	return r.data, r.err
}
