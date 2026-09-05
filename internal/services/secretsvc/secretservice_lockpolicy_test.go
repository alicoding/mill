package secretsvc

import (
	"testing"
	"time"

	"github.com/alicoding/mill/internal/adapters/credential"
	"github.com/alicoding/mill/internal/adapters/localauth"
	"github.com/alicoding/mill/internal/adapters/secretvault"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// newPolicyTestService builds an unlocked vault with the real idle-poll
// loop stopped: every test here drives autoLockTick by hand with a
// pinned idle reading, so nothing depends on wall-clock timing.
func newPolicyTestService(t *testing.T) *SecretService {
	t.Helper()
	path := t.TempDir() + "/secrets.kdbx"
	s := NewSecretService(secretvault.New(path), credential.NewInMemory(), servicetest.NewFakeStore())
	s.StopAutoLock()
	if err := s.SetupVault(); err != nil {
		t.Fatalf("SetupVault: %v", err)
	}
	return s
}

// pinIdle makes idleTimeFn report exactly d for the rest of the test.
func pinIdle(t *testing.T, d time.Duration) {
	t.Helper()
	orig := idleTimeFn
	t.Cleanup(func() { idleTimeFn = orig })
	idleTimeFn = func() (time.Duration, error) { return d, nil }
}

// TestLockPolicy_DefaultsMatchTheShippedTimeout pins the migration
// property: with nothing persisted, the policy reads as the 15-minute
// timeout the vault enforced before it was configurable, sleep and
// user switch on, minimize off.
func TestLockPolicy_DefaultsMatchTheShippedTimeout(t *testing.T) {
	s := newPolicyTestService(t)
	got := s.VaultLockPolicy()
	want := LockPolicy{LockAfterSeconds: 900, LockOnSleep: true, LockOnUserSwitch: true, LockOnMinimize: false}
	if got != want {
		t.Fatalf("VaultLockPolicy() = %+v, want %+v", got, want)
	}
}

// TestAutoLock_PresetBoundaries proves every preset the surface offers
// locks at its own boundary and not one second before it: idle exactly
// at the timeout locks, idle one second under it does not.
func TestAutoLock_PresetBoundaries(t *testing.T) {
	presets := []int{60, 300, 900, 1800, 3600, 4 * 3600, 8 * 3600}
	for _, seconds := range presets {
		threshold := time.Duration(seconds) * time.Second
		t.Run(threshold.String()+"/just_under", func(t *testing.T) {
			s := newPolicyTestService(t)
			if err := s.SetVaultLockPolicy(LockPolicy{LockAfterSeconds: seconds}); err != nil {
				t.Fatalf("SetVaultLockPolicy: %v", err)
			}
			pinIdle(t, threshold-time.Second)
			s.autoLockTick()
			if !s.VaultStatus().Unlocked {
				t.Fatalf("vault locked at %v idle, one second under the %v timeout", threshold-time.Second, threshold)
			}
		})
		t.Run(threshold.String()+"/at_the_boundary", func(t *testing.T) {
			s := newPolicyTestService(t)
			if err := s.SetVaultLockPolicy(LockPolicy{LockAfterSeconds: seconds}); err != nil {
				t.Fatalf("SetVaultLockPolicy: %v", err)
			}
			pinIdle(t, threshold)
			s.autoLockTick()
			if s.VaultStatus().Unlocked {
				t.Fatalf("vault still unlocked at %v idle, its own %v timeout", threshold, threshold)
			}
		})
	}
}

// TestAutoLock_NeverDoesNotLock pins the one preset with no boundary:
// zero seconds means the idle timer is off, at any idle reading.
func TestAutoLock_NeverDoesNotLock(t *testing.T) {
	s := newPolicyTestService(t)
	if err := s.SetVaultLockPolicy(LockPolicy{LockAfterSeconds: 0}); err != nil {
		t.Fatalf("SetVaultLockPolicy: %v", err)
	}
	pinIdle(t, 30*24*time.Hour)
	s.autoLockTick()
	if !s.VaultStatus().Unlocked {
		t.Fatal("vault locked on idle with the timeout set to Never")
	}
}

// TestSetVaultLockPolicy_ClampsTheTimeout proves the stored timeout can
// never be a value the surface cannot express: a negative one becomes
// Never, a sub-minute one becomes a minute, and one past thirty days is
// held there.
func TestSetVaultLockPolicy_ClampsTheTimeout(t *testing.T) {
	cases := []struct{ in, want int }{
		{-30, 0},
		{0, 0},
		{1, 60},
		{59, 60},
		{60, 60},
		{43200 * 60, 43200 * 60},
		{43200*60 + 1, 43200 * 60},
	}
	for _, tc := range cases {
		s := newPolicyTestService(t)
		if err := s.SetVaultLockPolicy(LockPolicy{LockAfterSeconds: tc.in}); err != nil {
			t.Fatalf("SetVaultLockPolicy(%d): %v", tc.in, err)
		}
		if got := s.VaultLockPolicy().LockAfterSeconds; got != tc.want {
			t.Fatalf("SetVaultLockPolicy(%d) stored %d, want %d", tc.in, got, tc.want)
		}
	}
}

// TestHandleLockTrigger_OnlyWhenItsCheckboxIsOn walks every trigger
// against every checkbox: a trigger locks the vault when and only when
// the checkbox that names it is on. Sleep and screen lock share one
// checkbox by design -- both mean the Mac is no longer in front of the
// person who unlocked it.
func TestHandleLockTrigger_OnlyWhenItsCheckboxIsOn(t *testing.T) {
	cases := []struct {
		trigger  string
		policy   LockPolicy
		wantLock bool
	}{
		{TriggerSleep, LockPolicy{LockOnSleep: true}, true},
		{TriggerSleep, LockPolicy{LockOnSleep: false}, false},
		{TriggerScreenLock, LockPolicy{LockOnSleep: true}, true},
		{TriggerScreenLock, LockPolicy{LockOnSleep: false}, false},
		{TriggerUserSwitch, LockPolicy{LockOnUserSwitch: true}, true},
		{TriggerUserSwitch, LockPolicy{LockOnUserSwitch: false}, false},
		{TriggerMinimize, LockPolicy{LockOnMinimize: true}, true},
		{TriggerMinimize, LockPolicy{LockOnMinimize: false}, false},
		// A trigger no checkbox names is ignored, never treated as a
		// reason to lock.
		{"somethingElse", LockPolicy{LockOnSleep: true, LockOnUserSwitch: true, LockOnMinimize: true}, false},
	}
	for _, tc := range cases {
		s := newPolicyTestService(t)
		if err := s.SetVaultLockPolicy(tc.policy); err != nil {
			t.Fatalf("SetVaultLockPolicy: %v", err)
		}
		s.HandleLockTrigger(tc.trigger)
		locked := !s.VaultStatus().Unlocked
		if locked != tc.wantLock {
			t.Fatalf("%s with %+v: locked = %v, want %v", tc.trigger, tc.policy, locked, tc.wantLock)
		}
	}
}

// TestUnlockCapability_ReportsWhatThisMacCanAsk pins the value the
// unlock surface words its own label from -- every capability the
// adapter can report reaches the frontend unchanged.
func TestUnlockCapability_ReportsWhatThisMacCanAsk(t *testing.T) {
	s := newPolicyTestService(t)
	orig := localAuthCapabilityFn
	t.Cleanup(func() { localAuthCapabilityFn = orig })
	for _, want := range []localauth.Capability{
		localauth.CapabilityNone,
		localauth.CapabilityPassword,
		localauth.CapabilityTouchID,
		localauth.CapabilityTouchIDAndWatch,
		localauth.CapabilityWatch,
	} {
		localAuthCapabilityFn = func() localauth.Capability { return want }
		if got := s.UnlockCapability(); got != string(want) {
			t.Fatalf("UnlockCapability() = %q, want %q", got, want)
		}
	}
}
