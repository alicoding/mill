package secretsvc

import (
	"errors"
	"path/filepath"
	"testing"

	"github.com/alicoding/mill/internal/adapters/credential"
	"github.com/alicoding/mill/internal/domain/usererror"
)

// DebugCorruptVaultKeyForTests is e2e's only way to reproduce
// ErrKeyMismatch (goal 0359): it must actually turn a working vault
// into one whose next unlock reports "the key on this device doesn't
// open this vault file", and it must refuse outside the in-memory test
// keyring so it can never reach a real device's keychain.
func TestDebugCorruptVaultKeyForTests_CausesKeyMismatch(t *testing.T) {
	t.Setenv("MILL_TEST_KEYRING", "memory")
	dir := t.TempDir()
	path := filepath.Join(dir, "secrets.kdbx")
	creds := credential.NewInMemory()
	s := newVaultAt(t, path, creds)
	if err := s.SetupVault(); err != nil {
		t.Fatalf("SetupVault: %v", err)
	}
	s.LockVault()

	if err := s.DebugCorruptVaultKeyForTests(); err != nil {
		t.Fatalf("DebugCorruptVaultKeyForTests: %v", err)
	}

	err := s.UnlockVault()
	if code, ok := usererror.Of(err); !errors.Is(err, ErrKeyMismatch) || !ok || code.Code != "key-mismatch" {
		t.Fatalf("UnlockVault after corrupting the key = %v, want ErrKeyMismatch carrying the key-mismatch code", err)
	}
}

func TestDebugCorruptVaultKeyForTests_RefusesOutsideTestKeyring(t *testing.T) {
	// MILL_TEST_KEYRING deliberately left unset.
	dir := t.TempDir()
	path := filepath.Join(dir, "secrets.kdbx")
	s := newVaultAt(t, path, credential.NewInMemory())
	if err := s.SetupVault(); err != nil {
		t.Fatalf("SetupVault: %v", err)
	}

	if err := s.DebugCorruptVaultKeyForTests(); err == nil {
		t.Fatal("DebugCorruptVaultKeyForTests outside MILL_TEST_KEYRING=memory = nil error, want a refusal")
	}
}
