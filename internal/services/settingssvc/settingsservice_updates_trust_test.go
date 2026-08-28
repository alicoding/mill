package settingssvc

import (
	"errors"
	"testing"
)

// swapTrustIdentityFn substitutes trustIdentityFn for the duration of
// a test and restores it afterward -- trustIdentityFn defaults to the
// real codesigning.TrustIdentity, which touches a real macOS keychain
// and its authentication dialog.
func swapTrustIdentityFn(t *testing.T, fake func() error) {
	t.Helper()
	original := trustIdentityFn
	trustIdentityFn = fake
	t.Cleanup(func() { trustIdentityFn = original })
}

func TestTrustSigningIdentity_CallsTrustIdentityFn(t *testing.T) {
	set := newTestSettingsService(t)
	var called bool
	swapTrustIdentityFn(t, func() error {
		called = true
		return nil
	})

	if err := set.TrustSigningIdentity(); err != nil {
		t.Fatalf("TrustSigningIdentity: %v", err)
	}
	if !called {
		t.Error("trustIdentityFn was not called")
	}
}

func TestTrustSigningIdentity_PropagatesError(t *testing.T) {
	set := newTestSettingsService(t)
	wantErr := errors.New("no window server session to answer the prompt")
	swapTrustIdentityFn(t, func() error { return wantErr })

	err := set.TrustSigningIdentity()
	if !errors.Is(err, wantErr) {
		t.Errorf("TrustSigningIdentity error = %v, want %v", err, wantErr)
	}
}

// swapIsTrustedFn substitutes isTrustedFn for the duration of a test
// and restores it afterward -- isTrustedFn defaults to the real
// codesigning.IsTrusted, which touches a real macOS keychain.
func swapIsTrustedFn(t *testing.T, fake func() (bool, error)) {
	t.Helper()
	original := isTrustedFn
	isTrustedFn = fake
	t.Cleanup(func() { isTrustedFn = original })
}

func TestIsSigningTrusted_CallsIsTrustedFn(t *testing.T) {
	set := newTestSettingsService(t)
	var called bool
	swapIsTrustedFn(t, func() (bool, error) {
		called = true
		return true, nil
	})

	trusted, err := set.IsSigningTrusted()
	if err != nil {
		t.Fatalf("IsSigningTrusted: %v", err)
	}
	if !called {
		t.Error("isTrustedFn was not called")
	}
	if !trusted {
		t.Error("trusted = false, want true")
	}
}

func TestIsSigningTrusted_PropagatesError(t *testing.T) {
	set := newTestSettingsService(t)
	wantErr := errors.New("unsupported platform")
	swapIsTrustedFn(t, func() (bool, error) { return false, wantErr })

	trusted, err := set.IsSigningTrusted()
	if !errors.Is(err, wantErr) {
		t.Errorf("IsSigningTrusted error = %v, want %v", err, wantErr)
	}
	if trusted {
		t.Error("trusted = true, want false alongside the error")
	}
}
