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
	"log/slog"
	"sync"
	"time"

	"github.com/alicoding/mill/internal/adapters/credential"
	"github.com/alicoding/mill/internal/adapters/secretauditstore"
	"github.com/alicoding/mill/internal/adapters/secretvault"
	"github.com/alicoding/mill/internal/adapters/settings"
	"github.com/alicoding/mill/internal/domain/secret"
	"github.com/alicoding/mill/internal/services/dataevent"
)

// masterKeyPrefix + a vault file's own identity is that file's key
// slot in credential.Store. The identity comes from the vault's
// plaintext header (secretvault.Vault.ID), so a key is always looked up
// FOR the file being opened: two Mill instances, or one instance and a
// restored backup, can each hold their own key instead of the second
// vault's creation silently overwriting the first's (goal 0330).
const masterKeyPrefix = "mill-secret-vault-key"

// legacyMasterKeyID is the single machine-global slot every vault key
// was written to before identities existed. Read (and migrated away
// from) on unlock; never written by a new vault.
const legacyMasterKeyID = masterKeyPrefix

// masterKeyIDFor names vaultID's own key slot.
func masterKeyIDFor(vaultID string) string { return masterKeyPrefix + "." + vaultID }

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

// ErrNoVaultKey is returned by Unlock when a vault file exists but no
// key for it is in this device's keychain (e.g. the vault file was
// copied from another machine, or the keychain item was removed) --
// distinct from ErrNoVault so the frontend can tell "never set up" from
// "set up somewhere else" and word the empty state accordingly.
//
// The leading token is the stable handle the frontend matches on:
// Wails delivers a bound method's error to JavaScript as text, so the
// UI's own wording is chosen by matching a token that never changes
// rather than by matching a sentence that will.
var ErrNoVaultKey = errors.New("no-vault-key: no key for this vault is stored on this device")

// ErrKeyMismatch is returned by Unlock when a key IS stored for this
// vault but does not open the file -- the file was replaced, or the key
// belongs to a different vault. Never deletes or overwrites anything:
// the stored key may still be the right key for some other copy of the
// file the user has.
var ErrKeyMismatch = errors.New("key-mismatch: the stored key does not open this vault file")

// Status is VaultStatus's return shape -- the one read the frontend
// needs to decide which of "set up," "unlock," or "browse" to show.
// RequireAuth is the persisted setting; AuthAvailable reports whether
// this Mac can authenticate at all, which decides whether the
// requirement can be offered. Both are prompt-free reads, safe on every
// build including server mode, where AuthAvailable is always false.
type Status struct {
	Exists        bool
	Unlocked      bool
	RequireAuth   bool
	AuthAvailable bool
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
	// auditStore/auditLog back recordAccess (secretservice_audit.go) --
	// nil until OpenAudit wires them (goal 0203 S3), which every test
	// that constructs SecretService directly never calls, so recordAccess
	// degrades to a no-op rather than a nil-pointer panic.
	auditStore *secretauditstore.Store
	auditLog   *slog.Logger
	// sources lists the user's enabled secret sources (ADR-0050); nil
	// until wired, when only the vault resolves.
	sources SourcesLister
	// settings holds the app-level unlock requirement
	// (secretservice_auth.go). Never holds a key or a secret.
	settings settings.Store
}

// NewSecretService constructs the service and starts the auto-lock poll
// loop immediately -- same "ready to use, no second init step" shape as
// NewConfigureService.
func NewSecretService(vault secretvault.Vault, credentials credential.Store, store settings.Store) *SecretService {
	s := &SecretService{vault: vault, credentials: credentials, settings: store}
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

// VaultStatus reports whether a vault exists on this device, whether
// it's currently unlocked, and which key protection is active -- the
// one read the frontend's browse surface polls/subscribes to decide
// what to render.
func (s *SecretService) VaultStatus() Status {
	return Status{
		Exists:        s.vault.Exists(),
		Unlocked:      s.vault.Unlocked(),
		RequireAuth:   s.requireAuthToUnlock(),
		AuthAvailable: localAuthAvailableFn(),
	}
}

// SetupVault creates a brand-new vault: mints a random master key,
// creates the KDBX file (which mints the vault's own identity), stores
// the key under that identity's slot in the OS keychain, and seeds one
// obviously-fake demo entry (secret.BuiltInDemo) so the browse surface
// is never empty on a fresh vault (.claude/rules/testing.md's "every
// capability ships a seeded example"). Fails if a vault already exists
// -- SetupVault is one-time, never an implicit reset; ResetVault is the
// explicit door.
func (s *SecretService) SetupVault() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.vault.Exists() {
		return fmt.Errorf("a vault already exists on this device")
	}
	return s.createVaultLocked()
}

// ResetVault archives the current vault file beside itself as a
// timestamped ".bak" and creates a fresh one in its place. The archived
// file's own key, if this device still holds one, is left exactly where
// it is: restoring the backup must still work. Only reachable from the
// locked state where the stored key can't open the file -- the one
// situation where the entries are unreadable anyway.
func (s *SecretService) ResetVault() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.vault.Exists() {
		if _, err := s.vault.Backup(); err != nil {
			return err
		}
	}
	return s.createVaultLocked()
}

// createVaultLocked is SetupVault/ResetVault's shared body. Caller must
// hold s.mu and have established there is no file in the way. A failure
// to store the key leaves the new file in place with no key for it,
// which is exactly the state ResetVault itself recovers from.
func (s *SecretService) createVaultLocked() error {
	key, err := secretvault.NewMasterKey()
	if err != nil {
		return err
	}
	vaultID, err := s.vault.Create(key)
	if err != nil {
		return err
	}
	if err := s.credentials.Set(masterKeyIDFor(vaultID), secretvault.EncodeMasterKey(key)); err != nil {
		return fmt.Errorf("saving vault key: %w", err)
	}
	if _, err := s.vault.Upsert(secret.BuiltInDemo()); err != nil {
		return fmt.Errorf("seeding demo entry: %w", err)
	}
	dataevent.Emit("secret", "")
	return nil
}

// UnlockVault authenticates the person at the keyboard when the unlock
// requirement is on (secretservice_auth.go), fetches the key stored for
// THIS vault file, and holds the decrypted database in memory for this
// app session (goal 0185: "unlock once per app session, hold the vault
// key in memory, auto-lock on idle").
func (s *SecretService) UnlockVault() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.vault.Exists() {
		return ErrNoVault
	}
	if err := s.gateUnlockLocked(); err != nil {
		return err
	}
	vaultID, err := s.vault.ID()
	if err != nil {
		return fmt.Errorf("reading this vault's identity: %w", err)
	}
	account := legacyMasterKeyID
	if vaultID != "" {
		account = masterKeyIDFor(vaultID)
	}
	encoded, err := s.credentials.Get(account)
	if err != nil {
		if errors.Is(err, credential.ErrNotFound) {
			return ErrNoVaultKey
		}
		return fmt.Errorf("reading vault key: %w", err)
	}
	key, err := secretvault.DecodeMasterKey(encoded)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrKeyMismatch, err)
	}
	if err := s.vault.Unlock(key); err != nil {
		return fmt.Errorf("%w: %v", ErrKeyMismatch, err)
	}
	if vaultID == "" {
		s.bindLegacyKeyLocked(encoded)
	}
	dataevent.Emit("secret", "")
	return nil
}

// bindLegacyKeyLocked moves a pre-identity vault onto the bound slot,
// once its key has been PROVEN to open the file: stamp an identity into
// the header, copy the key to that identity's slot, drop the global
// one. Best-effort by design -- the vault is already open and the user
// asked for exactly that, so a failure here is logged and retried on
// the next unlock rather than turned into a failed unlock.
func (s *SecretService) bindLegacyKeyLocked(encoded string) {
	vaultID, err := s.vault.AssignID()
	if err == nil {
		err = s.credentials.Set(masterKeyIDFor(vaultID), encoded)
	}
	if err != nil {
		if s.auditLog != nil {
			s.auditLog.Warn("binding the vault key to its file", "error", err)
		}
		return
	}
	if err := s.credentials.Delete(legacyMasterKeyID); err != nil && s.auditLog != nil {
		s.auditLog.Warn("removing the unbound vault key", "error", err)
	}
}

// LockVault discards the in-memory decrypted vault -- manual lock, same
// effect as auto-lock firing.
func (s *SecretService) LockVault() {
	s.vault.Lock()
	dataevent.Emit("secret", "")
}
