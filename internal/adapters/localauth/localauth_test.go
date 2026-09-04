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
