// Package localauth is Mill's seam onto Apple's LocalAuthentication
// framework: ask the person at the keyboard to prove they are the
// device owner (Touch ID, Apple Watch, or the Mac password) and block
// until they do or refuse.
//
// It exists because a keychain ACL cannot do this job in a self-signed
// build. kSecAttrAccessControl is enforced only inside macOS's
// data-protection keychain, which a process may use only with an
// application-identifier / keychain-access-groups entitlement -- i.e.
// with an Apple Developer Team ID. Without one, the ACL is stored on
// the item and ignored: the value reads back with no prompt. So the
// authentication requirement is a gate in FRONT of a plain
// login-keychain item, not a property of the item (goal 0330,
// docs/SPEC.md). The honest consequence: this proves who is at the
// keyboard, and does not stop another process running as the same user
// from reading the item.
//
// darwin && !server only (localauth_darwin.go). Every other build
// keeps the ErrUnsupported defaults below: a LaunchAgent/server
// instance has no console session to show an authentication sheet in,
// so it structurally never attempts one and fails closed instead.
package localauth

import (
	"errors"
	"fmt"
)

// ErrUnsupported is returned by Authenticate on any build that cannot
// present platform authentication -- a non-darwin platform, or any
// server build regardless of OS (see the package doc).
var ErrUnsupported = errors.New("localauth: platform authentication is not available on this build")

// The named half of LocalAuthentication's LAError surface. Every code
// LAError.h defines is mapped; anything the framework adds later
// arrives through errorForCode's fallback carrying its numeric code
// rather than being silently treated as a cancel.
var (
	// ErrCancelled -- the evaluation ended without a decision: the user
	// dismissed the sheet (LAErrorUserCancel), the system interrupted it
	// (LAErrorSystemCancel), or the context was invalidated while it ran
	// (LAErrorAppCancel).
	ErrCancelled = errors.New("localauth: authentication was cancelled")
	// ErrFallback -- the user chose the sheet's fallback button
	// (LAErrorUserFallback). Reachable only for policies that HAVE a
	// fallback the framework hands back to the caller.
	ErrFallback = errors.New("localauth: the user chose to authenticate another way")
	// ErrFailed -- credentials were supplied and rejected
	// (LAErrorAuthenticationFailed).
	ErrFailed = errors.New("localauth: authentication was not successful")
	// ErrNotAvailable -- the policy can never succeed as configured: no
	// device password set (LAErrorPasscodeNotSet), no biometry hardware
	// or biometry unusable (LAErrorBiometryNotAvailable,
	// LAErrorBiometryNotPaired, LAErrorBiometryDisconnected), nothing
	// enrolled (LAErrorBiometryNotEnrolled), or no companion device in
	// range (LAErrorCompanionNotAvailable).
	ErrNotAvailable = errors.New("localauth: this Mac has no authentication method set up")
	// ErrLockout -- too many failed biometric attempts; the device
	// password is required to unlock biometry again
	// (LAErrorBiometryLockout).
	ErrLockout = errors.New("localauth: biometric authentication is locked out")
	// ErrInvalidContext -- the LAContext was already invalidated
	// (LAErrorInvalidContext). A programming error at this seam, never
	// a user-visible state.
	ErrInvalidContext = errors.New("localauth: the authentication context was already invalidated")
	// ErrNotInteractive -- authentication would have required UI that
	// the caller forbade (LAErrorNotInteractive).
	ErrNotInteractive = errors.New("localauth: authentication would require a prompt that is not allowed here")
	// ErrInvalidDimensions -- embedded authentication UI was given
	// invalid dimensions (LAErrorInvalidDimensions). Unreachable for a
	// plain evaluatePolicy call, mapped for completeness.
	ErrInvalidDimensions = errors.New("localauth: the authentication prompt could not be sized")
)

// LAError codes, restated from the macOS SDK's LAPublicDefines.h --
// they are #defines, so they exist in no linkable symbol a non-cgo
// build could reach.
const (
	codeAuthenticationFailed  = -1
	codeUserCancel            = -2
	codeUserFallback          = -3
	codeSystemCancel          = -4
	codePasscodeNotSet        = -5
	codeBiometryNotAvailable  = -6
	codeBiometryNotEnrolled   = -7
	codeBiometryLockout       = -8
	codeAppCancel             = -9
	codeInvalidContext        = -10
	codeCompanionNotAvailable = -11
	codeBiometryNotPaired     = -12
	codeBiometryDisconnected  = -13
	codeInvalidDimensions     = -14
	codeNotInteractive        = -1004
)

// errorForCode maps an LAError code onto this package's named errors.
// Exhaustive over LAError.h as of the SDK this was written against; an
// unrecognized code keeps its number so a future framework addition is
// diagnosable instead of misfiled.
func errorForCode(code int) error {
	switch code {
	case codeUserCancel, codeSystemCancel, codeAppCancel:
		return ErrCancelled
	case codeUserFallback:
		return ErrFallback
	case codeAuthenticationFailed:
		return ErrFailed
	case codePasscodeNotSet, codeBiometryNotAvailable, codeBiometryNotEnrolled,
		codeCompanionNotAvailable, codeBiometryNotPaired, codeBiometryDisconnected:
		return ErrNotAvailable
	case codeBiometryLockout:
		return ErrLockout
	case codeInvalidContext:
		return ErrInvalidContext
	case codeNotInteractive:
		return ErrNotInteractive
	case codeInvalidDimensions:
		return ErrInvalidDimensions
	case codeForeignErrorDomain:
		return ErrFailed
	default:
		return fmt.Errorf("localauth: authentication failed (LAError %d)", code)
	}
}

// availableImpl/authenticateImpl are swapped at package-init time by
// localauth_darwin.go's own init() (real LocalAuthentication calls) and
// left at these defaults on every other build. Tests swap them too --
// no test may raise a real authentication sheet.
var (
	availableImpl    = func() bool { return false }
	authenticateImpl = func(_ string) error { return ErrUnsupported }
)

// Available reports whether this Mac can evaluate
// LAPolicyDeviceOwnerAuthentication at all -- biometry OR the device
// password. False when nothing is enrolled and no password is set, and
// on every build without the framework. Cheap and prompt-free, so a UI
// may call it to decide whether to offer the requirement at all;
// Apple's own guidance is to consume the answer immediately rather
// than cache it (LAContext.h, canEvaluatePolicy).
func Available() bool { return availableImpl() }

// Authenticate presents the system authentication sheet with reason as
// its localized explanation ("Mill is trying to <reason>") and BLOCKS
// the calling goroutine until the person authenticates, refuses, or
// the system ends the evaluation. Returns nil on success, otherwise
// one of this package's named errors.
//
// Thread contract, from LAContext.h's own documentation of
// evaluatePolicy:localizedReason:reply: -- the call itself does not
// block and may be made from any thread; the reply block "is executed
// on a private queue internal to the framework in an unspecified
// threading context," with no guarantee of queue, thread, or run loop.
// The adapter therefore joins the reply back to the caller with a
// semaphore rather than assuming any queue, and the caller must not be
// the main thread, which the sheet's own UI needs. Mill satisfies that
// structurally: every bound method reaches Go from Wails v3's HTTP
// transport handler (wails/v3@v3.0.0-beta.15,
// pkg/application/transport_http.go's HandleRuntimeCallWithIDs call),
// i.e. on net/http's own per-request goroutine, never on the thread the
// application's event loop runs on.
func Authenticate(reason string) error { return authenticateImpl(reason) }

// codeForeignErrorDomain is not an LAError: the reply block handed back
// a failure from another error domain. Positive, so it can never
// collide with an LAError code. Treated as a plain authentication
// failure -- fail closed, never as a cancel.
const codeForeignErrorDomain = 1
