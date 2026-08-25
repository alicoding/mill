package secretsvc

import (
	"errors"
	"testing"

	"github.com/alicoding/mill/internal/adapters/presencekey"
	"github.com/alicoding/mill/internal/adapters/secretvault"
)

// fakePresenceStore backs presenceWrapFn/presenceReadFn/presenceRemoveFn
// in these tests -- the OS-bound real presencekey package (interactive
// prompts, the real keychain) is never touched here, matching
// launchatlogin_manager_test.go's own fake-behind-a-seam shape. It
// records call order so the migration-ordering tests below can assert
// verify-before-delete directly, not just the end state.
type fakePresenceStore struct {
	items   map[string][]byte // key: service+"/"+account
	readErr error
	calls   []string
	wrapErr error
}

func newFakePresenceStore() *fakePresenceStore {
	return &fakePresenceStore{items: map[string][]byte{}}
}

func (f *fakePresenceStore) key(service, account string) string { return service + "/" + account }

func (f *fakePresenceStore) wrap(service, account string, value []byte) error {
	f.calls = append(f.calls, "wrap")
	if f.wrapErr != nil {
		return f.wrapErr
	}
	f.items[f.key(service, account)] = value
	return nil
}

func (f *fakePresenceStore) read(service, account, _ string) ([]byte, error) {
	f.calls = append(f.calls, "read")
	if f.readErr != nil {
		return nil, f.readErr
	}
	v, ok := f.items[f.key(service, account)]
	if !ok {
		return nil, presencekey.ErrNotFound
	}
	return v, nil
}

func (f *fakePresenceStore) remove(service, account string) error {
	f.calls = append(f.calls, "remove")
	delete(f.items, f.key(service, account))
	return nil
}

// withFakePresence swaps presenceWrapFn/presenceReadFn/presenceRemoveFn
// for the duration of one test and restores the real (ErrUnsupported-
// on-this-platform-or-defaults) values after.
func withFakePresence(t *testing.T, f *fakePresenceStore) {
	t.Helper()
	origWrap, origRead, origRemove := presenceWrapFn, presenceReadFn, presenceRemoveFn
	presenceWrapFn, presenceReadFn, presenceRemoveFn = f.wrap, f.read, f.remove
	t.Cleanup(func() { presenceWrapFn, presenceReadFn, presenceRemoveFn = origWrap, origRead, origRemove })
}

func newUnlockedTestService(t *testing.T) *SecretService {
	t.Helper()
	s := newTestService(t)
	if err := s.SetupVault(); err != nil {
		t.Fatalf("SetupVault: %v", err)
	}
	return s
}

func TestSetTouchIDProtection_Enable_MigrationOrdering(t *testing.T) {
	s := newUnlockedTestService(t)
	f := newFakePresenceStore()
	withFakePresence(t, f)

	if err := s.SetTouchIDProtection(true); err != nil {
		t.Fatalf("SetTouchIDProtection(true): %v", err)
	}

	// verify-before-delete: the sequence must be wrap (create the new
	// item) THEN read (verify it works) BEFORE anything is deleted --
	// no "remove" call at all on a clean enable, since the OLD item is
	// credential.Store's plain slot, only ever overwritten, never
	// deleted by this path.
	want := []string{"wrap", "read"}
	if len(f.calls) != len(want) {
		t.Fatalf("call order = %v, want %v", f.calls, want)
	}
	for i, c := range want {
		if f.calls[i] != c {
			t.Fatalf("call order = %v, want %v", f.calls, want)
		}
	}

	protected := s.currentlyPresenceProtected()
	if !protected {
		t.Fatal("expected presence protection to be active after enable")
	}
}

func TestSetTouchIDProtection_Enable_VerifyFails_RollsBackWithoutTouchingPlainKey(t *testing.T) {
	s := newUnlockedTestService(t)
	f := newFakePresenceStore()
	f.readErr = errors.New("verify read failed")
	withFakePresence(t, f)

	if err := s.SetTouchIDProtection(true); err == nil {
		t.Fatal("SetTouchIDProtection(true) with a failing verify read: want an error")
	}

	// Rollback: the just-added presence item is removed, and the plain
	// credential.Store slot was never touched (the key can still
	// unlock the vault normally).
	if _, ok := f.items[f.key(presenceService, masterKeyID)]; ok {
		t.Fatal("presence item still present after a failed enable -- rollback did not remove it")
	}
	protected := s.currentlyPresenceProtected()
	if protected {
		t.Fatal("vault reads as presence-protected after a failed enable -- the key was lost or the sentinel leaked")
	}

	// The plain key is still readable and still unlocks the vault --
	// "never lose the key" holds even after a failed enable.
	s.LockVault()
	if err := s.UnlockVault(); err != nil {
		t.Fatalf("UnlockVault after a failed enable: %v", err)
	}
}

func TestSetTouchIDProtection_Enable_ReadBackMismatch_RollsBack(t *testing.T) {
	s := newUnlockedTestService(t)
	f := newFakePresenceStore()
	withFakePresence(t, f)
	// Corrupt the value on the way in so the read-back never matches --
	// simulates a keychain-layer integrity problem, not a plain error.
	realWrap := f.wrap
	presenceWrapFn = func(service, account string, value []byte) error {
		return realWrap(service, account, append(value, byte('!')))
	}

	if err := s.SetTouchIDProtection(true); err == nil {
		t.Fatal("SetTouchIDProtection(true) with a corrupted read-back: want an error")
	}
	if _, ok := f.items[f.key(presenceService, masterKeyID)]; ok {
		t.Fatal("presence item still present after a read-back mismatch -- rollback did not remove it")
	}
}

func TestSetTouchIDProtection_Disable_RequiresPromptedReadFirst(t *testing.T) {
	s := newUnlockedTestService(t)
	f := newFakePresenceStore()
	withFakePresence(t, f)

	if err := s.SetTouchIDProtection(true); err != nil {
		t.Fatalf("enable: %v", err)
	}
	f.calls = nil

	if err := s.SetTouchIDProtection(false); err != nil {
		t.Fatalf("SetTouchIDProtection(false): %v", err)
	}
	if len(f.calls) == 0 || f.calls[0] != "read" {
		t.Fatalf("disable call order = %v, want a read call first (anti-downgrade)", f.calls)
	}

	protected := s.currentlyPresenceProtected()
	if protected {
		t.Fatal("still presence-protected after disable")
	}
	// The vault must still unlock normally now, with no prompt needed.
	s.LockVault()
	if err := s.UnlockVault(); err != nil {
		t.Fatalf("UnlockVault after disable: %v", err)
	}
}

func TestSetTouchIDProtection_Disable_PromptFails_StaysProtected(t *testing.T) {
	s := newUnlockedTestService(t)
	f := newFakePresenceStore()
	withFakePresence(t, f)
	if err := s.SetTouchIDProtection(true); err != nil {
		t.Fatalf("enable: %v", err)
	}
	f.readErr = presencekey.ErrCanceled

	if err := s.SetTouchIDProtection(false); !errors.Is(err, ErrAuthenticationCanceled) {
		t.Fatalf("SetTouchIDProtection(false) with a canceled prompt: err = %v, want ErrAuthenticationCanceled", err)
	}
	protected := s.currentlyPresenceProtected()
	if !protected {
		t.Fatal("no longer presence-protected after a canceled disable -- anti-downgrade property broken")
	}
}

func TestSetTouchIDProtection_AlreadyInTargetState_NoOp(t *testing.T) {
	s := newUnlockedTestService(t)
	f := newFakePresenceStore()
	withFakePresence(t, f)

	if err := s.SetTouchIDProtection(false); err != nil {
		t.Fatalf("SetTouchIDProtection(false) when already off: %v", err)
	}
	if len(f.calls) != 0 {
		t.Fatalf("calls = %v, want none -- already in the target state", f.calls)
	}
}

func TestSetTouchIDProtection_RequiresUnlockedVault(t *testing.T) {
	s := newUnlockedTestService(t)
	f := newFakePresenceStore()
	withFakePresence(t, f)
	s.LockVault()

	if err := s.SetTouchIDProtection(true); !errors.Is(err, secretvault.ErrLocked) {
		t.Fatalf("SetTouchIDProtection on a locked vault: err = %v, want secretvault.ErrLocked", err)
	}
}

// TestUnlockVault_PresenceProtected_UnsupportedBuild_FailsClosed pins
// goal 0204 item 4's server-mode contract: a build that cannot present
// authentication UI (presencekey.ErrUnsupported -- what every non-
// darwin/server build's default closures return, see presencekey.go)
// must fail UnlockVault closed with one clear, actionable error, never
// hang and never leak a raw keychain/cgo error string.
func TestUnlockVault_PresenceProtected_UnsupportedBuild_FailsClosed(t *testing.T) {
	s := newUnlockedTestService(t)
	f := newFakePresenceStore()
	withFakePresence(t, f)
	if err := s.SetTouchIDProtection(true); err != nil {
		t.Fatalf("enable: %v", err)
	}
	s.LockVault()

	// Simulate an unsupported build encountering the presence-gated
	// item -- the exact seam presencekey.Read itself returns
	// ErrUnsupported through on such a build.
	presenceReadFn = func(string, string, string) ([]byte, error) { return nil, presencekey.ErrUnsupported }

	err := s.UnlockVault()
	if !errors.Is(err, ErrPresenceUnsupported) {
		t.Fatalf("UnlockVault on an unsupported build: err = %v, want ErrPresenceUnsupported", err)
	}
	if s.VaultStatus().Unlocked {
		t.Fatal("vault reports Unlocked after a failed-closed UnlockVault")
	}
}

// TestVaultStatus_PresenceProtected_ReflectsSentinel_NoImplCall proves
// PresenceProtected/VaultStatus never touch presenceReadFn/WrapFn at
// all -- it's a plain credential.Store read, so it must work
// identically even when the presence implementation is entirely
// ErrUnsupported (server mode never even compiles the real one).
func TestVaultStatus_PresenceProtected_ReflectsSentinel_NoImplCall(t *testing.T) {
	s := newUnlockedTestService(t)
	f := newFakePresenceStore()
	withFakePresence(t, f)
	if err := s.SetTouchIDProtection(true); err != nil {
		t.Fatalf("enable: %v", err)
	}
	f.calls = nil
	presenceReadFn = func(string, string, string) ([]byte, error) { return nil, presencekey.ErrUnsupported }
	presenceWrapFn = func(string, string, []byte) error { return presencekey.ErrUnsupported }

	status := s.VaultStatus()
	if !status.PresenceProtected {
		t.Fatal("VaultStatus().PresenceProtected = false, want true")
	}
	if len(f.calls) != 0 {
		t.Fatalf("VaultStatus called the presence implementation (%v) -- it must be a plain credential.Store read", f.calls)
	}
}

func TestVaultStatus_PresenceProtected_DefaultFalse(t *testing.T) {
	s := newUnlockedTestService(t)
	if s.VaultStatus().PresenceProtected {
		t.Fatal("VaultStatus().PresenceProtected = true on a freshly set-up vault, want false")
	}
}
