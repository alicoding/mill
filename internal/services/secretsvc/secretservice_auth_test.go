package secretsvc

import (
	"errors"
	"sync"
	"testing"

	"github.com/alicoding/mill/internal/adapters/credential"
	"github.com/alicoding/mill/internal/adapters/localauth"
	"github.com/alicoding/mill/internal/adapters/presencekey"
	"github.com/alicoding/mill/internal/adapters/secretvault"
	"github.com/alicoding/mill/internal/domain/secret"
	"github.com/alicoding/mill/internal/domain/usererror"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// fakeVault stands in for a real KDBX file wherever a test needs to
// drive states a file can't cheaply be put into -- a pre-identity
// vault, or a key that opens nothing. Entry storage is deliberately
// absent: no test here reads or writes entries.
type fakeVault struct {
	mu          sync.Mutex
	exists      bool
	unlocked    bool
	opensWith   string
	id          string
	path        string
	assignCalls int
	backupCalls int
}

func (f *fakeVault) Exists() bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.exists
}

func (f *fakeVault) Unlocked() bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.unlocked
}

func (f *fakeVault) Path() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.path
}

func (f *fakeVault) Create(masterKey []byte) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.exists, f.unlocked = true, true
	f.opensWith = secretvault.EncodeMasterKey(masterKey)
	f.id = secretvault.NewVaultID()
	return f.id, nil
}

func (f *fakeVault) Unlock(masterKey []byte) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if secretvault.EncodeMasterKey(masterKey) != f.opensWith {
		return errors.New("fakeVault: wrong key")
	}
	f.unlocked = true
	return nil
}

func (f *fakeVault) Lock() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.unlocked = false
}

func (f *fakeVault) ID() (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.id, nil
}

func (f *fakeVault) AssignID() (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.assignCalls++
	if f.id == "" {
		f.id = secretvault.NewVaultID()
	}
	return f.id, nil
}

func (f *fakeVault) Backup() (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.backupCalls++
	f.exists, f.unlocked, f.id = false, false, ""
	return "archived.bak", nil
}

func (f *fakeVault) List() ([]secret.Summary, error)        { return nil, nil }
func (f *fakeVault) Get(string) (secret.Entry, error)       { return secret.Entry{}, secretvault.ErrNotFound }
func (f *fakeVault) History(string) ([]secret.Entry, error) { return nil, nil }
func (f *fakeVault) Upsert(e secret.Entry) (secret.Entry, error) {
	if e.ID == "" {
		e.ID = "fake-entry"
	}
	return e, nil
}
func (f *fakeVault) Delete(string) error { return nil }

func mustKey(t *testing.T) []byte {
	t.Helper()
	key, err := secretvault.NewMasterKey()
	if err != nil {
		t.Fatalf("NewMasterKey: %v", err)
	}
	return key
}

// unlockableService returns a service over an already-created fake
// vault, locked, with its key stored.
func unlockableService(t *testing.T) (*SecretService, *fakeVault, *servicetest.FakeStore) {
	t.Helper()
	creds := credential.NewInMemory()
	store := servicetest.NewFakeStore()
	fake := &fakeVault{}
	s := NewSecretService(fake, creds, store)
	t.Cleanup(s.StopAutoLock)
	if err := s.SetupVault(); err != nil {
		t.Fatalf("SetupVault: %v", err)
	}
	s.LockVault()
	return s, fake, store
}

// With the requirement off, the vault opens without the gate ever being
// consulted -- the default posture, and the one every existing install
// keeps.
func TestUnlockSkipsTheGateWhenNotRequired(t *testing.T) {
	s, _, _ := unlockableService(t)
	called := false
	swapAuth(t, func() bool { return true }, func(string) error { called = true; return nil })

	if err := s.UnlockVault(); err != nil {
		t.Fatalf("UnlockVault: %v", err)
	}
	if called {
		t.Fatal("the authentication gate ran with the requirement off")
	}
}

// With the requirement on and authentication passed, the vault opens.
func TestUnlockRunsTheGateWhenRequired(t *testing.T) {
	s, _, store := unlockableService(t)
	var reason string
	swapAuth(t, func() bool { return true }, func(r string) error { reason = r; return nil })
	if err := store.Set(requireAuthKey, true); err != nil {
		t.Fatalf("Set: %v", err)
	}

	if err := s.UnlockVault(); err != nil {
		t.Fatalf("UnlockVault: %v", err)
	}
	if reason != unlockReason {
		t.Fatalf("gate reason = %q, want %q", reason, unlockReason)
	}
}

// Dismissing the sheet leaves the vault shut and says so in the words
// the unlock surface words itself from.
func TestUnlockCancelledLeavesTheVaultLocked(t *testing.T) {
	s, fake, store := unlockableService(t)
	swapAuth(t, func() bool { return true }, func(string) error { return localauth.ErrCancelled })
	if err := store.Set(requireAuthKey, true); err != nil {
		t.Fatalf("Set: %v", err)
	}

	err := s.UnlockVault()
	if code, ok := usererror.Of(err); !errors.Is(err, ErrUnlockCancelled) || !ok || code.Code != "unlock-cancelled" {
		t.Fatalf("UnlockVault = %v, want ErrUnlockCancelled carrying the unlock-cancelled code", err)
	}
	if fake.Unlocked() {
		t.Fatal("vault unlocked after a cancelled authentication")
	}
}

// A Mac that can no longer authenticate fails CLOSED: a vault whose
// owner asked for the gate never opens without one.
func TestUnlockFailsClosedWhenAuthenticationIsUnavailable(t *testing.T) {
	s, fake, store := unlockableService(t)
	swapAuth(t, func() bool { return false }, func(string) error { return localauth.ErrUnsupported })
	if err := store.Set(requireAuthKey, true); err != nil {
		t.Fatalf("Set: %v", err)
	}

	err := s.UnlockVault()
	if code, ok := usererror.Of(err); !errors.Is(err, ErrAuthUnavailable) || !ok || code.Code != "auth-unavailable" {
		t.Fatalf("UnlockVault = %v, want ErrAuthUnavailable carrying the auth-unavailable code", err)
	}
	if fake.Unlocked() {
		t.Fatal("vault unlocked with the requirement on and no way to honour it")
	}
}

// The requirement can't be turned on where it could never be honoured.
func TestSetTouchIDProtectionRefusedWithoutAuthentication(t *testing.T) {
	s, _, store := unlockableService(t)
	swapAuth(t, func() bool { return false }, func(string) error { return localauth.ErrUnsupported })
	if err := s.UnlockVault(); err != nil {
		t.Fatalf("UnlockVault: %v", err)
	}

	if err := s.SetTouchIDProtection(true); !errors.Is(err, ErrAuthUnavailable) {
		t.Fatalf("SetTouchIDProtection(true) = %v, want ErrAuthUnavailable", err)
	}
	if v, _ := store.Get(requireAuthKey).(bool); v {
		t.Fatal("the requirement was persisted despite being refused")
	}
	if s.VaultStatus().RequireAuth {
		t.Fatal("VaultStatus reports the requirement on after a refusal")
	}
}

// Turning the requirement on and off is the setting, and VaultStatus
// reports it plus whether this Mac could honour it at all.
func TestSetTouchIDProtectionRoundTrip(t *testing.T) {
	s, _, store := unlockableService(t)
	swapAuth(t, func() bool { return true }, func(string) error { return nil })
	if err := s.UnlockVault(); err != nil {
		t.Fatalf("UnlockVault: %v", err)
	}

	if err := s.SetTouchIDProtection(true); err != nil {
		t.Fatalf("SetTouchIDProtection(true): %v", err)
	}
	status := s.VaultStatus()
	if !status.RequireAuth || !status.AuthAvailable {
		t.Fatalf("VaultStatus = %+v, want RequireAuth and AuthAvailable true", status)
	}
	if v, _ := store.Get(requireAuthKey).(bool); !v {
		t.Fatal("the requirement was not persisted")
	}

	if err := s.SetTouchIDProtection(false); err != nil {
		t.Fatalf("SetTouchIDProtection(false): %v", err)
	}
	if s.VaultStatus().RequireAuth {
		t.Fatal("VaultStatus still reports the requirement after turning it off")
	}
}

// The requirement is not changeable on a vault you can't currently see.
func TestSetTouchIDProtectionRequiresUnlocked(t *testing.T) {
	s, _, _ := unlockableService(t)
	swapAuth(t, func() bool { return true }, func(string) error { return nil })
	if err := s.SetTouchIDProtection(true); !errors.Is(err, secretvault.ErrLocked) {
		t.Fatalf("SetTouchIDProtection on a locked vault = %v, want ErrLocked", err)
	}
}

// The one-time move off the inert ACL-gated keychain item: the key
// returns to a readable slot, the old item is deleted, and the
// requirement the user originally asked for is now actually enforced.
func TestMigrateLegacyPresenceProtection(t *testing.T) {
	creds := credential.NewInMemory()
	store := servicetest.NewFakeStore()
	key := secretvault.EncodeMasterKey(mustKey(t))
	if err := creds.Set(legacyMasterKeyID, legacyPresenceSentinel); err != nil {
		t.Fatalf("Set: %v", err)
	}
	var removed [2]string
	swapPresence(t,
		func(service, account, _ string) ([]byte, error) {
			if service != legacyPresenceService || account != legacyMasterKeyID {
				t.Fatalf("read (%q, %q), want (%q, %q)", service, account, legacyPresenceService, legacyMasterKeyID)
			}
			return []byte(key), nil
		},
		func(service, account string) error { removed = [2]string{service, account}; return nil })

	s := NewSecretService(&fakeVault{exists: true, opensWith: key}, creds, store)
	t.Cleanup(s.StopAutoLock)
	s.MigrateLegacyPresenceProtection()

	restored, err := creds.Get(legacyMasterKeyID)
	if err != nil || restored != key {
		t.Fatalf("key after migration = %q, %v; want %q", restored, err, key)
	}
	if removed != [2]string{legacyPresenceService, legacyMasterKeyID} {
		t.Fatalf("removed %v, want the legacy presence item", removed)
	}
	if v, _ := store.Get(requireAuthKey).(bool); !v {
		t.Fatal("the unlock requirement was not carried over")
	}
}

// A vault that never used the old item is left completely alone.
func TestMigrateLegacyPresenceProtectionIsANoOpWithoutTheSentinel(t *testing.T) {
	creds := credential.NewInMemory()
	store := servicetest.NewFakeStore()
	key := secretvault.EncodeMasterKey(mustKey(t))
	if err := creds.Set(legacyMasterKeyID, key); err != nil {
		t.Fatalf("Set: %v", err)
	}
	swapPresence(t,
		func(string, string, string) ([]byte, error) {
			t.Fatal("the legacy presence item was read for a vault that never had one")
			return nil, nil
		},
		func(string, string) error {
			t.Fatal("the legacy presence item was deleted for a vault that never had one")
			return nil
		})

	s := NewSecretService(&fakeVault{exists: true, opensWith: key}, creds, store)
	t.Cleanup(s.StopAutoLock)
	s.MigrateLegacyPresenceProtection()

	if v, _ := store.Get(requireAuthKey).(bool); v {
		t.Fatal("the unlock requirement was turned on for a vault that never asked for it")
	}
}

// A migration that can't read the old item back changes nothing, so the
// next launch can try again.
func TestMigrateLegacyPresenceProtectionLeavesTheKeyOnFailure(t *testing.T) {
	creds := credential.NewInMemory()
	store := servicetest.NewFakeStore()
	if err := creds.Set(legacyMasterKeyID, legacyPresenceSentinel); err != nil {
		t.Fatalf("Set: %v", err)
	}
	swapPresence(t,
		func(string, string, string) ([]byte, error) { return nil, presencekey.ErrUnsupported },
		func(string, string) error { t.Fatal("the item was deleted after a failed read"); return nil })

	s := NewSecretService(&fakeVault{exists: true}, creds, store)
	t.Cleanup(s.StopAutoLock)
	s.MigrateLegacyPresenceProtection()

	still, err := creds.Get(legacyMasterKeyID)
	if err != nil || still != legacyPresenceSentinel {
		t.Fatalf("slot after a failed migration = %q, %v; want the marker untouched", still, err)
	}
	if v, _ := store.Get(requireAuthKey).(bool); v {
		t.Fatal("the requirement was turned on by a migration that did not complete")
	}
}

func swapAuth(t *testing.T, available func() bool, authenticate func(string) error) {
	t.Helper()
	prevAvailable, prevAuth := localAuthAvailableFn, localAuthAuthenticateFn
	localAuthAvailableFn, localAuthAuthenticateFn = available, authenticate
	t.Cleanup(func() { localAuthAvailableFn, localAuthAuthenticateFn = prevAvailable, prevAuth })
}

func swapPresence(t *testing.T, read func(string, string, string) ([]byte, error), remove func(string, string) error) {
	t.Helper()
	prevRead, prevRemove := presenceReadFn, presenceRemoveFn
	presenceReadFn, presenceRemoveFn = read, remove
	t.Cleanup(func() { presenceReadFn, presenceRemoveFn = prevRead, prevRemove })
}
