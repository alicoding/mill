// Package secretsvc is the Wails-facing layer over Mill's secret
// manager (docs/goals/0185-secrets-as-references.md): a human-facing
// credential store, first -- reveal/hide, copy to clipboard, add/edit/
// delete, history -- with workflow resolution (HTTPRequest/AIProvider/
// MCP server/exec env secrets) as a second consumer of the same vault.
// Mirrors configuresvc's own shape: owns session state and persistence
// wiring a stateless adapter (internal/adapters/secretvault) can't own,
// no domain logic of its own (.claude/rules/backend.md).
package secretsvc

import (
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/alicoding/mill/internal/adapters/credential"
	"github.com/alicoding/mill/internal/adapters/secretvault"
	"github.com/alicoding/mill/internal/domain/secret"
	"github.com/alicoding/mill/internal/services/dataevent"
)

// masterKeyID is the vault master key's own slot in credential.Store --
// a fixed, well-known id, not per-entity like every other credential
// that store holds (HTTPRequest/AIProvider secrets), since there is
// exactly one vault. This is the keychain-held-key path the goal file's
// "Unlock: system authentication" section names as the explicit fallback
// when a biometry-gated item can't be built with a confidently verified
// thread-affinity contract (see secretvault package doc comment) --
// same ACL boundary as every other secret credential.Store already
// protects (Finding C, goal file), not a silent downgrade.
const masterKeyID = "mill-secret-vault-key"

// defaultAutoLockThreshold matches KeePassXC's own shipped default
// (goal file, "Unlock: system authentication" -- "KeePassXC's own
// shipped default is 900s").
const defaultAutoLockThreshold = 900 * time.Second

// autoLockPollInterval bounds how stale the auto-lock check can be --
// short enough that "idle past the threshold" is caught promptly,
// cheap enough (idletime.Seconds shells out to ioreg on macOS) not to
// matter at this rate.
const autoLockPollInterval = 10 * time.Second

// ErrNoVault is returned by Unlock when Setup has never been called on
// this device.
var ErrNoVault = errors.New("no secret vault has been set up on this device yet")

// ErrNoVaultKey is returned by Unlock when a vault file exists but its
// master key isn't in this device's keychain (e.g. the vault file was
// copied from another machine, or the keychain item was removed) --
// distinct from ErrNoVault so the frontend can tell "never set up" from
// "set up somewhere else" and word the empty state accordingly.
var ErrNoVaultKey = errors.New("this vault's key isn't available on this device")

// Status is VaultStatus's return shape -- the one read the frontend
// needs to decide which of "set up," "unlock," or "browse" to show.
type Status struct {
	Exists   bool
	Unlocked bool
}

// SecretService is the Wails-facing layer over the vault. credentials is
// shared with ConfigureService's own HTTPRequest/AIProvider secrets
// (main.go wires the same credential.Store into both) -- the vault
// master key lives in the identical OS keychain, just under its own id.
type SecretService struct {
	mu           sync.Mutex
	vault        secretvault.Vault
	credentials  credential.Store
	stopAutoLock func()
}

// NewSecretService constructs the service and starts the auto-lock poll
// loop immediately -- same "ready to use, no second init step" shape as
// NewConfigureService.
func NewSecretService(vault secretvault.Vault, credentials credential.Store) *SecretService {
	s := &SecretService{vault: vault, credentials: credentials}
	s.stopAutoLock = s.startAutoLock(defaultAutoLockThreshold, autoLockPollInterval)
	return s
}

// StopAutoLock halts the background idle-poll loop -- exported for test
// cleanup only, never a frontend RPC.
//
//wails:ignore
func (s *SecretService) StopAutoLock() {
	if s.stopAutoLock != nil {
		s.stopAutoLock()
	}
}

// VaultStatus reports whether a vault exists on this device and whether
// it's currently unlocked -- the one read the frontend's browse surface
// polls/subscribes to decide what to render.
func (s *SecretService) VaultStatus() Status {
	return Status{Exists: s.vault.Exists(), Unlocked: s.vault.Unlocked()}
}

// SetupVault creates a brand-new vault: mints a random master key,
// stores it in the OS keychain under masterKeyID, creates the KDBX file,
// and seeds one obviously-fake demo entry (secret.BuiltInDemo) so the
// browse surface is never empty on a fresh vault
// (.claude/rules/testing.md's "every capability ships a seeded
// example"). Fails if a vault already exists -- SetupVault is one-time,
// never an implicit reset.
func (s *SecretService) SetupVault() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.vault.Exists() {
		return fmt.Errorf("a vault already exists on this device")
	}
	key, err := secretvault.NewMasterKey()
	if err != nil {
		return err
	}
	if err := s.credentials.Set(masterKeyID, secretvault.EncodeMasterKey(key)); err != nil {
		return fmt.Errorf("saving vault key: %w", err)
	}
	if err := s.vault.Create(key); err != nil {
		_ = s.credentials.Delete(masterKeyID)
		return err
	}
	if _, err := s.vault.Upsert(secret.BuiltInDemo()); err != nil {
		return fmt.Errorf("seeding demo entry: %w", err)
	}
	dataevent.Emit("secret", "")
	return nil
}

// UnlockVault fetches the master key from the keychain and unlocks the
// vault, holding the decrypted database in memory for this app session
// (goal file: "unlock once per app session, hold the vault key in
// memory, auto-lock on idle").
func (s *SecretService) UnlockVault() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.vault.Exists() {
		return ErrNoVault
	}
	encoded, err := s.credentials.Get(masterKeyID)
	if err != nil {
		if errors.Is(err, credential.ErrNotFound) {
			return ErrNoVaultKey
		}
		return fmt.Errorf("reading vault key: %w", err)
	}
	key, err := secretvault.DecodeMasterKey(encoded)
	if err != nil {
		return err
	}
	if err := s.vault.Unlock(key); err != nil {
		return fmt.Errorf("the vault key on this device doesn't match this vault file: %w", err)
	}
	dataevent.Emit("secret", "")
	return nil
}

// LockVault discards the in-memory decrypted vault -- manual lock, same
// effect as auto-lock firing.
func (s *SecretService) LockVault() {
	s.vault.Lock()
	dataevent.Emit("secret", "")
}
