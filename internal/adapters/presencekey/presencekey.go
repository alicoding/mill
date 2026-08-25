// Package presencekey manages ONE presence-gated macOS keychain item:
// create/replace it protected by kSecAttrAccessControl
// (kSecAccessControlUserPresence -- Touch ID, Apple Watch, or the
// device password), and read it back, which BLOCKS the calling
// goroutine through the system authentication prompt --
// SecItemCopyMatching's own documented contract for an item carrying
// kSecAttrAccessControl (goal 0204's DoR gate, sourced from Apple's own
// documentation). Deleting an item never prompts: SecItemDelete matches
// on attributes only and never touches the protected value.
//
// darwin && !server only (presencekey_darwin.go) -- no maintained Go
// keyring library exposes SecAccessControl (verified against
// keybase/go-keychain and 99designs/keyring source, goal 0204), so this
// is architecture.md's last-resort cgo-shim clause, narrow and
// single-purpose like internal/adapters/launchatlogin's own SMAppService
// status read. Every other build (non-darwin, or any server build
// regardless of OS) keeps wrapImpl/readImpl/removeImpl at their default
// ErrUnsupported closures below: a LaunchAgent/server instance cannot
// present authentication UI at all (Apple DTS: "Can't show UI while not
// in a console session"), so this package structurally never attempts a
// presence-protected read there -- there is no darwin-only file to even
// compile into that build.
package presencekey

import "errors"

// ErrUnsupported is returned by every function on a build that cannot
// manage presence-gated keychain items -- any non-darwin platform, or
// any server build regardless of OS (see package doc).
var ErrUnsupported = errors.New("presencekey: user-presence-protected keychain items are not available on this build")

// ErrCanceled is returned by Read when the user dismisses the system
// authentication prompt (errSecUserCanceled) -- distinct from a real
// failure so callers can word it as a cancellation, not an error.
var ErrCanceled = errors.New("presencekey: authentication was canceled")

// ErrNotFound is returned by Read when no item matches service/account.
var ErrNotFound = errors.New("presencekey: no matching keychain item")

// wrapImpl/readImpl/removeImpl are swapped at package-init time by
// presencekey_darwin.go's own init() (real Security-framework calls) --
// left at these ErrUnsupported-returning defaults on every other build.
// This package's own tests swap them too, to exercise Read's
// goroutine/channel wrapping without touching cgo or the real keychain.
var (
	wrapImpl   = func(_, _ string, _ []byte) error { return ErrUnsupported }
	readImpl   = func(_, _, _ string) ([]byte, error) { return nil, ErrUnsupported }
	removeImpl = func(_, _ string) error { return ErrUnsupported }
)

// Wrap creates or replaces service/account's presence-gated keychain
// item with value. Adding a protected item needs no authentication
// itself -- only later reading its value does -- so this never prompts.
func Wrap(service, account string, value []byte) error {
	return wrapImpl(service, account, value)
}

// Remove deletes service/account's item, presence-gated or not.
// SecItemDelete matches on attributes only and never touches the
// protected value, so it never triggers the authentication prompt.
// Removing an item that doesn't exist is not an error (idempotent,
// matching this package's own rollback/cleanup call sites).
func Remove(service, account string) error {
	return removeImpl(service, account)
}

// readResult carries Read's own goroutine handoff.
type readResult struct {
	data []byte
	err  error
}

// Read returns service/account's presence-gated value. The underlying
// system call BLOCKS through the platform authentication prompt (Touch
// ID / Apple Watch / the device password), shown via prompt -- so Read
// always runs it on a FRESH goroutine, never on the goroutine that
// called Read, regardless of what that goroutine is (goal 0204's DoR
// gate: "called OFF the main thread from a goroutine the app can
// abandon"). The result channel is buffered so that goroutine can
// always complete and exit even if a future caller stops waiting on it
// -- releasing/abandoning the wait does not, and cannot, dismiss an
// in-flight system prompt (Apple's own documented contract).
func Read(service, account, prompt string) ([]byte, error) {
	ch := make(chan readResult, 1)
	go func() {
		data, err := readImpl(service, account, prompt)
		ch <- readResult{data, err}
	}()
	r := <-ch
	return r.data, r.err
}
