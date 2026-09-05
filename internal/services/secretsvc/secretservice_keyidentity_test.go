package secretsvc

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/adapters/credential"
	"github.com/alicoding/mill/internal/adapters/secretvault"
	"github.com/alicoding/mill/internal/domain/usererror"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// newVaultAt builds a service over path with its own in-memory keyring.
func newVaultAt(t *testing.T, path string, creds credential.Store) *SecretService {
	t.Helper()
	s := NewSecretService(secretvault.New(path), creds, servicetest.NewFakeStore())
	t.Cleanup(s.StopAutoLock)
	return s
}

// A vault's key is stored under that vault's own identity, so a second
// vault created on the same machine cannot overwrite the first's key --
// the defect goal 0330 exists to close.
func TestSetupBindsKeyToVaultIdentity(t *testing.T) {
	dir := t.TempDir()
	creds := credential.NewInMemory()

	first := newVaultAt(t, filepath.Join(dir, "first.kdbx"), creds)
	if err := first.SetupVault(); err != nil {
		t.Fatalf("SetupVault first: %v", err)
	}
	firstID, err := first.vault.ID()
	if err != nil || firstID == "" {
		t.Fatalf("first vault ID = %q, %v", firstID, err)
	}
	firstKey, err := creds.Get(masterKeyIDFor(firstID))
	if err != nil {
		t.Fatalf("first vault key not stored under its identity: %v", err)
	}
	if _, err := creds.Get(legacyMasterKeyID); !errors.Is(err, credential.ErrNotFound) {
		t.Fatalf("the unbound slot was written; Get = %v, want ErrNotFound", err)
	}

	second := newVaultAt(t, filepath.Join(dir, "second.kdbx"), creds)
	if err := second.SetupVault(); err != nil {
		t.Fatalf("SetupVault second: %v", err)
	}
	secondID, err := second.vault.ID()
	if err != nil || secondID == firstID {
		t.Fatalf("second vault ID = %q, %v; want a different id", secondID, err)
	}
	stillFirst, err := creds.Get(masterKeyIDFor(firstID))
	if err != nil || stillFirst != firstKey {
		t.Fatalf("first vault's key after a second Setup = %q, %v; want it untouched", stillFirst, err)
	}

	// Each opens with its own key, in either order.
	first.LockVault()
	second.LockVault()
	if err := second.UnlockVault(); err != nil {
		t.Fatalf("UnlockVault second: %v", err)
	}
	if err := first.UnlockVault(); err != nil {
		t.Fatalf("UnlockVault first: %v", err)
	}
}

// A vault written before identities existed keeps working, and the
// first successful unlock binds it: an id lands in the header, the key
// moves to that id's slot, and the machine-global slot is dropped.
// Driven over a fake vault: the real header round-trip is pinned in
// secretvault's own tests, and what belongs at THIS layer is which
// keychain slot is read and written, in which order.
func TestUnlockMigratesLegacyVaultOntoItsIdentity(t *testing.T) {
	creds := credential.NewInMemory()
	key := secretvault.EncodeMasterKey(mustKey(t))
	if err := creds.Set(legacyMasterKeyID, key); err != nil {
		t.Fatalf("Set: %v", err)
	}
	fake := &fakeVault{exists: true, opensWith: key}
	s := NewSecretService(fake, creds, servicetest.NewFakeStore())
	t.Cleanup(s.StopAutoLock)

	if err := s.UnlockVault(); err != nil {
		t.Fatalf("UnlockVault: %v", err)
	}
	if fake.id == "" {
		t.Fatal("no identity was assigned to the legacy vault")
	}
	bound, err := creds.Get(masterKeyIDFor(fake.id))
	if err != nil || bound != key {
		t.Fatalf("bound key = %q, %v; want %q", bound, err, key)
	}
	if _, err := creds.Get(legacyMasterKeyID); !errors.Is(err, credential.ErrNotFound) {
		t.Fatalf("unbound slot after migration: Get = %v, want ErrNotFound", err)
	}

	// The next unlock goes straight down the bound path -- nothing is
	// left in the machine-global slot for it to find.
	fake.Lock()
	if err := s.UnlockVault(); err != nil {
		t.Fatalf("second UnlockVault: %v", err)
	}
	if fake.assignCalls != 1 {
		t.Fatalf("AssignID called %d times, want exactly 1", fake.assignCalls)
	}
}

// A stored key that does not open the file reports the mismatch and
// touches nothing: the key may still be the right key for another copy
// of that vault.
func TestUnlockLegacyVaultWithWrongKeyReportsMismatch(t *testing.T) {
	creds := credential.NewInMemory()
	wrong := secretvault.EncodeMasterKey(mustKey(t))
	if err := creds.Set(legacyMasterKeyID, wrong); err != nil {
		t.Fatalf("Set: %v", err)
	}
	fake := &fakeVault{exists: true, opensWith: secretvault.EncodeMasterKey(mustKey(t))}
	s := NewSecretService(fake, creds, servicetest.NewFakeStore())
	t.Cleanup(s.StopAutoLock)

	err := s.UnlockVault()
	if !errors.Is(err, ErrKeyMismatch) {
		t.Fatalf("UnlockVault = %v, want ErrKeyMismatch", err)
	}
	if code, ok := usererror.Of(err); !ok || code.Code != "key-mismatch" {
		t.Fatalf("UnlockVault = %v, want the key-mismatch code", err)
	}
	if fake.Unlocked() {
		t.Fatal("vault unlocked despite a mismatched key")
	}
	still, err := creds.Get(legacyMasterKeyID)
	if err != nil || still != wrong {
		t.Fatalf("unbound slot after a mismatch = %q, %v; want it untouched", still, err)
	}
	if fake.id != "" {
		t.Fatal("an identity was stamped into a vault that never opened")
	}
}

// A vault file with no stored key at all is a different state from a
// mismatch, and says so.
func TestUnlockWithNoStoredKeyReportsNoVaultKey(t *testing.T) {
	path := filepath.Join(t.TempDir(), "secrets.kdbx")
	creds := credential.NewInMemory()
	s := newVaultAt(t, path, creds)
	if err := s.SetupVault(); err != nil {
		t.Fatalf("SetupVault: %v", err)
	}
	vaultID, err := s.vault.ID()
	if err != nil {
		t.Fatalf("ID: %v", err)
	}
	s.LockVault()
	if err := creds.Delete(masterKeyIDFor(vaultID)); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	err = s.UnlockVault()
	if code, ok := usererror.Of(err); !errors.Is(err, ErrNoVaultKey) || !ok || code.Code != "no-vault-key" {
		t.Fatalf("UnlockVault = %v, want ErrNoVaultKey carrying the no-vault-key code", err)
	}
}

// ResetVault keeps the unreadable file as a backup and hands back a
// working, unlocked, freshly seeded vault.
func TestResetVaultArchivesAndReplaces(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "secrets.kdbx")
	creds := credential.NewInMemory()
	s := newVaultAt(t, path, creds)
	if err := s.SetupVault(); err != nil {
		t.Fatalf("SetupVault: %v", err)
	}
	oldID, err := s.vault.ID()
	if err != nil {
		t.Fatalf("ID: %v", err)
	}
	s.LockVault()

	if err := s.ResetVault(); err != nil {
		t.Fatalf("ResetVault: %v", err)
	}
	if !s.vault.Unlocked() {
		t.Fatal("ResetVault left the vault locked")
	}
	newID, err := s.vault.ID()
	if err != nil || newID == "" || newID == oldID {
		t.Fatalf("vault ID after reset = %q, %v; want a new id", newID, err)
	}
	if _, err := creds.Get(masterKeyIDFor(newID)); err != nil {
		t.Fatalf("new vault's key not stored: %v", err)
	}
	// The old vault's own key is left alone -- restoring the backup has
	// to keep working.
	if _, err := creds.Get(masterKeyIDFor(oldID)); err != nil {
		t.Fatalf("the archived vault's key was removed: %v", err)
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("ReadDir: %v", err)
	}
	var backups int
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), "secrets.") && strings.HasSuffix(e.Name(), ".bak.kdbx") {
			backups++
		}
	}
	if backups != 1 {
		t.Fatalf("found %d .bak.kdbx files beside the vault, want exactly 1", backups)
	}

	// A fresh vault is usable immediately: the seeded example is there.
	list, err := s.ListSecrets()
	if err != nil {
		t.Fatalf("ListSecrets: %v", err)
	}
	if len(list) == 0 {
		t.Fatal("the replacement vault has no seeded entry")
	}
}

// TestResetVaultKeepsEveryArchive is goal 0359's own regression: a
// second reset used to overwrite the first's ".bak" file. Two
// consecutive resets must each mint their own archive, and each
// archive must still be openable with the key that made it -- the
// whole point of never overwriting a recovery copy.
func TestResetVaultKeepsEveryArchive(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "secrets.kdbx")
	creds := credential.NewInMemory()
	s := newVaultAt(t, path, creds)
	if err := s.SetupVault(); err != nil {
		t.Fatalf("SetupVault: %v", err)
	}
	firstID, err := s.vault.ID()
	if err != nil {
		t.Fatalf("ID: %v", err)
	}
	s.LockVault()

	if err := s.ResetVault(); err != nil {
		t.Fatalf("first ResetVault: %v", err)
	}
	secondID, err := s.vault.ID()
	if err != nil {
		t.Fatalf("ID after first reset: %v", err)
	}
	s.LockVault()

	if err := s.ResetVault(); err != nil {
		t.Fatalf("second ResetVault: %v", err)
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("ReadDir: %v", err)
	}
	var archives []string
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), "secrets.") && strings.HasSuffix(e.Name(), ".bak.kdbx") {
			archives = append(archives, e.Name())
		}
	}
	if len(archives) != 2 {
		t.Fatalf("found %d archives after two resets, want exactly 2 (one per reset): %v", len(archives), archives)
	}

	// Each archive is opened with the key its own reset stored -- the
	// first archive's key is firstID's, the second's is secondID's,
	// never each other's.
	for _, id := range []string{firstID, secondID} {
		key, err := creds.Get(masterKeyIDFor(id))
		if err != nil {
			t.Fatalf("key for %q missing: %v", id, err)
		}
		decoded, err := secretvault.DecodeMasterKey(key)
		if err != nil {
			t.Fatalf("decode key for %q: %v", id, err)
		}
		opened := false
		for _, name := range archives {
			v := secretvault.New(filepath.Join(dir, name))
			if vaultID, err := v.ID(); err != nil || vaultID != id {
				continue
			}
			if err := v.Unlock(decoded); err == nil {
				opened = true
				v.Lock()
				break
			}
		}
		if !opened {
			t.Errorf("no archive for vault %q opened with its own stored key", id)
		}
	}
}
