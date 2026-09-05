package secretsvc

import (
	"fmt"
	"os"

	"github.com/alicoding/mill/internal/adapters/secretvault"
)

// DebugCorruptVaultKeyForTests overwrites the key stored for the
// vault's own identity with a freshly minted, unrelated one, so the
// next unlock attempt reports ErrKeyMismatch -- e2e's only way to
// reproduce goal 0359's own defect (a stored key that no longer opens
// its vault file) without a second physical device holding the real
// key. Gated to MILL_TEST_KEYRING=memory, the same in-memory-keyring
// switch main.go itself uses to pick credential.NewInMemory() over the
// real OS keychain: refuses outside that mode, so this can never touch
// a real device's keychain.
func (s *SecretService) DebugCorruptVaultKeyForTests() error {
	if os.Getenv("MILL_TEST_KEYRING") != "memory" {
		return fmt.Errorf("debug test knobs are only available against the in-memory test keyring")
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	vaultID, err := s.vault.ID()
	if err != nil {
		return fmt.Errorf("reading this vault's identity: %w", err)
	}
	account := legacyMasterKeyID
	if vaultID != "" {
		account = masterKeyIDFor(vaultID)
	}
	wrongKey, err := secretvault.NewMasterKey()
	if err != nil {
		return fmt.Errorf("minting a mismatched key: %w", err)
	}
	return s.credentials.Set(account, secretvault.EncodeMasterKey(wrongKey))
}
