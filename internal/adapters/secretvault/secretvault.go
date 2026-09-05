// Package secretvault wraps github.com/tobischo/gokeepasslib/v3 behind
// Mill's own names, per CLAUDE.md's ports/adapters rule (goal
// 0185-secrets-as-references.md): a real, open KDBX vault file is the
// store of record for Mill's secret manager -- adopted specifically
// because it's a real, widely-implemented format a user can open in
// KeePassXC/KeePassDX, never a Mill-invented pattern (docs/goals/
// 0185-secrets-as-references.md's hard constraint). The OS keychain (existing
// internal/adapters/credential) keeps the one job it's genuinely good
// at: holding the vault's own master key under the user's account, not
// the secrets themselves -- Findings B/C in the goal file are why the
// keychain can't be the substrate on its own (no enumeration, no
// history, and its ACL boundary is the login session, not per-item
// authentication).
//
// The master key is a plain (non-ACL-gated) login-keychain item: an
// ACL built from kSecAttrAccessControl is enforced only in macOS's
// data-protection keychain, which requires an application-identifier /
// keychain-access-groups entitlement -- unavailable to a self-signed
// build (goal 0330). Requiring authentication before an unlock is
// therefore a LocalAuthentication gate in front of that plain item
// (internal/adapters/localauth), never a property of the item itself.
//
// Each vault file carries its own identity in its plaintext header
// (secretvault_id.go) and its key is stored under an account derived
// from that identity, so two vaults on one machine never overwrite
// each other's key and a key that cannot open a file is reported as
// such instead of surfacing as a decode failure.
package secretvault

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/alicoding/mill/internal/domain/secret"
	"github.com/tobischo/gokeepasslib/v3"
)

// MasterKeyLength is the raw master key size in bytes -- 32 bytes (256
// bits) is gokeepasslib's own key-file convention (credentials.go's
// ParseKeyData treats exactly-32-byte input as an already-correct raw
// key, no further hashing), and matches the entropy KDBX's own Argon2
// KDF is designed around.
const MasterKeyLength = 32

// ErrNotFound is returned by Get/History/Delete/Upsert(update) for an id
// with no matching entry.
var ErrNotFound = errors.New("secretvault: entry not found")

// ErrLocked is returned by every read/write method when the vault
// hasn't been unlocked yet -- the explicit, actionable state the goal
// file requires ("a workflow that fires during a locked window fails
// with an explicit 'vault is locked' state, never a silent
// wrong-credential error"), never a generic nil-pointer panic.
var ErrLocked = fmt.Errorf("secretvault: %w", secret.ErrVaultLocked)

// ErrAlreadyExists is returned by Create when a vault file is already
// present at Path -- Create is a one-time operation, never an implicit
// overwrite.
var ErrAlreadyExists = errors.New("secretvault: a vault already exists at this location")

// Vault is Mill's own secret-store interface -- callers (secretsvc)
// depend on this, never on *gokeepasslib.Database directly, so the
// underlying library stays swappable behind this one seam
// (.claude/rules/architecture.md's ports/adapters boundary).
type Vault interface {
	// Exists reports whether a vault file is already present on disk.
	Exists() bool
	// Unlocked reports whether the vault is currently open in memory.
	Unlocked() bool
	// Create makes a brand-new, empty vault file at Path, encrypted with
	// masterKey, and leaves it unlocked (ready to use immediately --
	// matches every other manager's own "create = you're now in it"
	// behavior). Returns the vault's newly minted identity, which the
	// caller stores its key under. Fails with ErrAlreadyExists if a
	// vault is already there.
	Create(masterKey []byte) (string, error)
	// ID returns the vault file's identity, read from its plaintext
	// header without the master key. "" means the file predates the
	// identity header (secretvault_id.go).
	ID() (string, error)
	// AssignID stamps an identity into an unlocked vault that has none
	// and writes the file immediately, returning the id now in force.
	AssignID() (string, error)
	// Backup renames the vault file to a timestamped, still-".kdbx"-
	// suffixed ".bak" sibling and locks the vault, returning the
	// archived path. Every call mints its own file -- never overwrites
	// an earlier archive. Leaves the file alone on failure.
	Backup() (string, error)
	// Unlock opens the existing vault file and decrypts it into memory
	// with masterKey. A wrong key or corrupt file returns
	// gokeepasslib.ErrInvalidDatabaseOrCredentials (wrapped).
	Unlock(masterKey []byte) error
	// Lock discards the in-memory decrypted database. Every subsequent
	// call other than Exists/Unlocked/Create/Unlock returns ErrLocked
	// until Unlock is called again.
	Lock()
	// List returns every entry's Summary (no Password/Notes), sorted by
	// Title.
	List() ([]secret.Summary, error)
	// Get returns one entry in full, Password included -- a reveal is
	// always this explicit call, never incidental to List.
	Get(id string) (secret.Entry, error)
	// History returns id's past versions, most-recently-superseded
	// first. Empty (not an error) for an entry that's never been
	// updated.
	History(id string) ([]secret.Entry, error)
	// Upsert creates (e.ID == "") or updates (e.ID set) an entry. An
	// update pushes the PRE-update version onto the entry's own history
	// before applying e's new values -- KDBX's native Entry.Histories,
	// never a Mill-invented history mechanism.
	Upsert(e secret.Entry) (secret.Entry, error)
	// Delete permanently removes an entry (and its history). No undo --
	// the same irreversible-delete contract as every other Mill entity.
	Delete(id string) error
}

// rootGroupName is the one flat group every entry lives directly under
// in phase 1 -- KeePassXC itself opens this file with the standard
// "Groups may be added" tree UI regardless, so a nested-group authoring
// surface inside Mill is real future work, not required for the vault
// to be usable or interoperable today.
const rootGroupName = "Mill"

// fileVault is Vault's real gokeepasslib-backed implementation. Every
// exported method takes mu, so callers never need their own locking.
type fileVault struct {
	mu   sync.Mutex
	path string
	db   *gokeepasslib.Database // nil while locked
}

// New returns the real, file-backed Vault at path. The parent directory
// is created lazily by Create, not here (mirrors settings.New's own
// "callers get a ready-to-use handle" shape, but Exists/Unlocked must
// work before any directory exists yet).
func New(path string) Vault {
	return &fileVault{path: path}
}

func (v *fileVault) Exists() bool {
	v.mu.Lock()
	defer v.mu.Unlock()
	_, err := os.Stat(v.path)
	return err == nil
}

func (v *fileVault) Unlocked() bool {
	v.mu.Lock()
	defer v.mu.Unlock()
	return v.db != nil
}

func (v *fileVault) Create(masterKey []byte) (string, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if _, err := os.Stat(v.path); err == nil {
		return "", ErrAlreadyExists
	}
	if err := os.MkdirAll(filepath.Dir(v.path), 0o700); err != nil {
		return "", fmt.Errorf("secretvault: creating vault directory: %w", err)
	}

	creds, err := gokeepasslib.NewKeyDataCredentials(masterKey)
	if err != nil {
		return "", fmt.Errorf("secretvault: deriving vault credentials: %w", err)
	}

	db := gokeepasslib.NewDatabase(gokeepasslib.WithDatabaseKDBXVersion41())
	db.Content.Meta.DatabaseName = "Mill"
	db.Credentials = creds
	root := gokeepasslib.NewGroup()
	root.Name = rootGroupName
	db.Content.Root = &gokeepasslib.RootData{Groups: []gokeepasslib.Group{root}}

	id := NewVaultID()
	setVaultIDHeader(db, id)

	v.db = db
	if err := v.persistLocked(); err != nil {
		v.db = nil
		return "", err
	}
	return id, nil
}

func (v *fileVault) Unlock(masterKey []byte) error {
	v.mu.Lock()
	defer v.mu.Unlock()

	file, err := os.Open(v.path) //nolint:gosec // v.path is Mill's own config-dir vault file, not user input
	if err != nil {
		return fmt.Errorf("secretvault: opening vault: %w", err)
	}
	defer func() { _ = file.Close() }()

	creds, err := gokeepasslib.NewKeyDataCredentials(masterKey)
	if err != nil {
		return fmt.Errorf("secretvault: deriving vault credentials: %w", err)
	}
	db := gokeepasslib.NewDatabase()
	db.Credentials = creds
	if err := gokeepasslib.NewDecoder(file).Decode(db); err != nil {
		return fmt.Errorf("secretvault: decoding vault: %w", err)
	}
	if err := db.UnlockProtectedEntries(); err != nil {
		return fmt.Errorf("secretvault: unlocking vault entries: %w", err)
	}
	if len(db.Content.Root.Groups) == 0 {
		root := gokeepasslib.NewGroup()
		root.Name = rootGroupName
		db.Content.Root.Groups = []gokeepasslib.Group{root}
	}
	v.db = db
	return nil
}

func (v *fileVault) Lock() {
	v.mu.Lock()
	defer v.mu.Unlock()
	v.db = nil
}

// persistLocked writes v.db to v.path -- caller must hold v.mu and have
// v.db != nil. gokeepasslib's Encoder.Encode expects entries already in
// their LOCKED (stream-cipher-encrypted) in-memory form (both of the
// library's own examples call db.LockProtectedEntries() immediately
// before constructing the encoder; Encode's own internal Unlock-then-
// Lock round-trip only produces correct ciphertext if its input already
// IS ciphertext -- confirmed directly against encoder.go's source).
// Encode leaves the db in that same locked state afterward, so this
// unlocks again before returning, keeping every OTHER method's
// assumption ("v.db, when non-nil, holds plaintext values") true across
// every persist call, not just the first.
func (v *fileVault) persistLocked() error {
	if err := v.db.LockProtectedEntries(); err != nil {
		return fmt.Errorf("secretvault: locking vault entries: %w", err)
	}

	tmp := v.path + ".tmp"
	f, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600) //nolint:gosec // tmp is derived from Mill's own config-dir vault path
	if err != nil {
		_ = v.db.UnlockProtectedEntries()
		return fmt.Errorf("secretvault: opening vault for write: %w", err)
	}
	encodeErr := gokeepasslib.NewEncoder(f).Encode(v.db)
	closeErr := f.Close()
	if unlockErr := v.db.UnlockProtectedEntries(); unlockErr != nil {
		return fmt.Errorf("secretvault: restoring vault entries after write: %w", unlockErr)
	}
	if encodeErr != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("secretvault: encoding vault: %w", encodeErr)
	}
	if closeErr != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("secretvault: writing vault: %w", closeErr)
	}
	// Atomic replace: a crash mid-write leaves the PREVIOUS vault file
	// intact rather than a half-written one -- the same durability bar
	// as any real password manager's own save path.
	if err := os.Rename(tmp, v.path); err != nil {
		return fmt.Errorf("secretvault: replacing vault file: %w", err)
	}
	return nil
}

// NewMasterKey mints a fresh, random master key of MasterKeyLength bytes
// -- exported so secretsvc (which owns storing it in the OS keychain via
// credential.Store) never needs its own crypto/rand call site.
func NewMasterKey() ([]byte, error) {
	key := make([]byte, MasterKeyLength)
	if _, err := rand.Read(key); err != nil {
		return nil, fmt.Errorf("secretvault: generating master key: %w", err)
	}
	return key, nil
}

// EncodeMasterKey/DecodeMasterKey round-trip a master key through the
// hex string credential.Store actually persists (its Store interface is
// string-in/string-out, matching every other secret it already holds).
func EncodeMasterKey(key []byte) string { return hex.EncodeToString(key) }

func DecodeMasterKey(encoded string) ([]byte, error) {
	key, err := hex.DecodeString(encoded)
	if err != nil {
		return nil, fmt.Errorf("secretvault: decoding master key: %w", err)
	}
	if len(key) != MasterKeyLength {
		return nil, fmt.Errorf("secretvault: master key has wrong length (%d, want %d)", len(key), MasterKeyLength)
	}
	return key, nil
}
