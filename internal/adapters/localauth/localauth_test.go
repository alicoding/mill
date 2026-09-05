package localauth

import (
	"errors"
	"strings"
	"testing"
)

// Every LAError code the SDK defines maps onto a named error -- an
// unmapped code is how a cancel gets silently misfiled as a success
// path or vice versa.
func TestErrorForCodeCoversEveryLAError(t *testing.T) {
	cases := []struct {
		code int
		want error
	}{
		{codeAuthenticationFailed, ErrFailed},
		{codeUserCancel, ErrCancelled},
		{codeUserFallback, ErrFallback},
		{codeSystemCancel, ErrCancelled},
		{codePasscodeNotSet, ErrNotAvailable},
		{codeBiometryNotAvailable, ErrNotAvailable},
		{codeBiometryNotEnrolled, ErrNotAvailable},
		{codeBiometryLockout, ErrLockout},
		{codeAppCancel, ErrCancelled},
		{codeInvalidContext, ErrInvalidContext},
		{codeCompanionNotAvailable, ErrNotAvailable},
		{codeBiometryNotPaired, ErrNotAvailable},
		{codeBiometryDisconnected, ErrNotAvailable},
		{codeInvalidDimensions, ErrInvalidDimensions},
		{codeNotInteractive, ErrNotInteractive},
		{codeForeignErrorDomain, ErrFailed},
	}
	for _, c := range cases {
		if got := errorForCode(c.code); !errors.Is(got, c.want) {
			t.Errorf("errorForCode(%d) = %v, want %v", c.code, got, c.want)
		}
	}
}

// A code the framework adds later keeps its number instead of being
// folded into one of the named errors.
func TestErrorForCodeKeepsUnknownCodes(t *testing.T) {
	err := errorForCode(-9999)
	if err == nil || !strings.Contains(err.Error(), "-9999") {
		t.Fatalf("errorForCode(-9999) = %v, want an error naming the code", err)
	}
	for _, named := range []error{ErrCancelled, ErrNotAvailable, ErrLockout, ErrFailed, ErrFallback} {
		if errors.Is(err, named) {
			t.Fatalf("unknown code matched %v", named)
		}
	}
}

// Builds without the framework fail closed rather than reporting the
// gate as passed.
func TestDefaultsFailClosed(t *testing.T) {
	prevAvailable, prevAuth := availableImpl, authenticateImpl
	availableImpl = func() bool { return false }
	authenticateImpl = func(_ string) error { return ErrUnsupported }
	t.Cleanup(func() { availableImpl, authenticateImpl = prevAvailable, prevAuth })

	if Available() {
		t.Fatal("Available reported true with the unsupported default in place")
	}
	if err := Authenticate("do something"); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("Authenticate = %v, want ErrUnsupported", err)
	}
}

// Available never prompts, so calling the real implementation is safe
// in a test -- it only has to answer without panicking or hanging.
func TestAvailableAnswersWithoutPrompting(t *testing.T) {
	_ = Available()
}

// TestCapabilityFor covers the whole truth table of the three
// prompt-free framework reads: the wording an unlock prompt promises
// must name only what the Mac in front of the reader can actually do.
func TestCapabilityFor(t *testing.T) {
	cases := []struct {
		deviceOwner, touchID, watch bool
		want                        Capability
	}{
		{false, false, false, CapabilityNone},
		// A narrower policy cannot be evaluable while the policy Mill
		// actually evaluates is not; if the framework ever says so,
		// "none" is still the honest answer, since Authenticate would
		// fail.
		{false, true, false, CapabilityNone},
		{false, false, true, CapabilityNone},
		{false, true, true, CapabilityNone},
		{true, false, false, CapabilityPassword},
		{true, true, false, CapabilityTouchID},
		{true, false, true, CapabilityWatch},
		{true, true, true, CapabilityTouchIDAndWatch},
	}
	for _, tc := range cases {
		if got := capabilityFor(tc.deviceOwner, tc.touchID, tc.watch); got != tc.want {
			t.Errorf("capabilityFor(%v, %v, %v) = %q, want %q", tc.deviceOwner, tc.touchID, tc.watch, got, tc.want)
		}
	}
}

// TestDescribe_DefaultsToNoneWithoutTheFramework pins the fail-closed
// default every build without LocalAuthentication keeps: no method is
// claimed where none can be evaluated.
func TestDescribe_DefaultsToNoneWithoutTheFramework(t *testing.T) {
	orig := capabilityImpl
	t.Cleanup(func() { capabilityImpl = orig })
	capabilityImpl = func() Capability { return CapabilityNone }
	if got := Describe(); got != CapabilityNone {
		t.Fatalf("Describe() = %q, want %q", got, CapabilityNone)
	}
}
