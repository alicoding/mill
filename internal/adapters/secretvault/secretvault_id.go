package secretvault

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	"github.com/tobischo/gokeepasslib/v3"
)

// vaultIDKey names the vault's own identity inside the KDBX4 plaintext
// (outer) header's PublicCustomData variant dictionary -- KDBX's own
// documented extension point for application data that must be
// readable WITHOUT the master key, which is precisely what binding a
// stored key to the file it opens requires (goal 0330). KeePassXC and
// every other KDBX4 reader preserves unknown PublicCustomData entries
// across a save, so a vault edited elsewhere keeps its Mill identity.
const vaultIDKey = "mill-vault-id"

// variantDictionaryVersion is the version word every KDBX4 variant
// dictionary carries (gokeepasslib writes the same 256 for its own
// KdfParameters dictionary, header.go's updateRawData).
const variantDictionaryVersion = 256

// variantDictionaryTypeString is the KDBX variant-dictionary type byte
// for a UTF-8 string value (0x18). gokeepasslib keeps its own copy of
// this constant unexported, so the value is restated here rather than
// inferred.
const variantDictionaryTypeString = 0x18

// backupTimestampLayout stamps the archived vault file's name. Sorts
// lexicographically in the same order it sorts chronologically, so a
// directory listing is already newest-last.
const backupTimestampLayout = "20060102-150405"

// ID returns the vault's identity from the KDBX plaintext header --
// WITHOUT the master key, which is the whole point: the caller uses it
// to look up which stored key belongs to THIS file before it has a key
// to try. An empty string (no error) means the file predates the
// identity header; a genuinely unreadable file returns an error.
//
// The header is read through the library's own decoder: Decoder.Decode
// populates db.Header from the plaintext prefix BEFORE it derives or
// verifies any credential (decoder.go), so the header survives the
// wrong-key failure the throwaway credentials below deliberately
// provoke. gokeepasslib exposes no header-only entry point --
// DBHeader.readFrom is unexported -- so provoking and discarding that
// failure IS the header-only path. The discarded Decode still runs the
// file's KDF once; at gokeepasslib's own parameters that is a
// sub-millisecond cost paid once per unlock attempt.
func (v *fileVault) ID() (string, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	return v.readIDLocked()
}

func (v *fileVault) readIDLocked() (string, error) {
	file, err := os.Open(v.path) //nolint:gosec // v.path is Mill's own config-dir vault file, not user input
	if err != nil {
		return "", fmt.Errorf("secretvault: opening vault: %w", err)
	}
	defer func() { _ = file.Close() }()

	probe, err := gokeepasslib.NewKeyDataCredentials(make([]byte, MasterKeyLength))
	if err != nil {
		return "", fmt.Errorf("secretvault: deriving header-probe credentials: %w", err)
	}
	db := gokeepasslib.NewDatabase()
	db.Credentials = probe
	_ = gokeepasslib.NewDecoder(file).Decode(db)

	if db.Header == nil || db.Header.FileHeaders == nil {
		return "", fmt.Errorf("secretvault: vault header is unreadable")
	}
	return vaultIDFromHeader(db), nil
}

// vaultIDFromHeader reads vaultIDKey out of an already-decoded header,
// tolerating every "not there" shape (no PublicCustomData at all, or a
// dictionary without this key) as the empty string.
func vaultIDFromHeader(db *gokeepasslib.Database) string {
	custom := db.Header.FileHeaders.PublicCustomData
	if custom == nil {
		return ""
	}
	item := custom.Get(vaultIDKey)
	if item == nil {
		return ""
	}
	return string(item.Value)
}

// setVaultIDHeader writes id into db's PublicCustomData, replacing any
// existing entry. NameLength/ValueLength are set explicitly:
// writeTo4VariantDictionary serializes those fields verbatim rather
// than deriving them from the byte slices, so leaving them zero writes
// a dictionary that reads back corrupt (header.go).
func setVaultIDHeader(db *gokeepasslib.Database, id string) {
	fh := db.Header.FileHeaders
	if fh.PublicCustomData == nil {
		fh.PublicCustomData = &gokeepasslib.VariantDictionary{Version: variantDictionaryVersion}
	}
	if fh.PublicCustomData.Version == 0 {
		fh.PublicCustomData.Version = variantDictionaryVersion
	}
	item := fh.PublicCustomData.Get(vaultIDKey)
	if item == nil {
		item = &gokeepasslib.VariantDictionaryItem{Name: []byte(vaultIDKey)}
		fh.PublicCustomData.Items = append(fh.PublicCustomData.Items, item)
	}
	item.Type = variantDictionaryTypeString
	item.Value = []byte(id)
	// Both lengths are bounded by vaultIDKey and a UUID string, so
	// neither can approach int32's range.
	item.NameLength = int32(len(item.Name))   //nolint:gosec // G115: a fixed 13-byte key name
	item.ValueLength = int32(len(item.Value)) //nolint:gosec // G115: a 36-byte UUID string
}

// NewVaultID mints a vault identity -- a random UUID, the same shape
// KDBX already uses for every entry and group id.
func NewVaultID() string { return uuid.NewString() }

// AssignID stamps a fresh identity into an already-unlocked vault's
// header and writes the file immediately, so the binding survives a
// crash before the next ordinary save. Returns the id it assigned. A
// vault that already carries an id keeps it, and the file is untouched.
func (v *fileVault) AssignID() (string, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.db == nil {
		return "", ErrLocked
	}
	if existing := vaultIDFromHeader(v.db); existing != "" {
		return existing, nil
	}
	id := NewVaultID()
	setVaultIDHeader(v.db, id)
	if err := v.persistLocked(); err != nil {
		return "", err
	}
	return id, nil
}

// Backup renames the vault file out of the way, leaving a timestamped
// ".bak" sibling, and locks whatever was open. The caller is expected
// to Create a replacement immediately; a failure here leaves the
// original file exactly where it was. Returns the archived path.
func (v *fileVault) Backup() (string, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if _, err := os.Stat(v.path); err != nil {
		return "", fmt.Errorf("secretvault: no vault to archive: %w", err)
	}
	dest := v.path + "." + time.Now().Format(backupTimestampLayout) + ".bak"
	// A second archive within the same second would otherwise silently
	// overwrite the first; suffix until the name is free.
	for i := 2; ; i++ {
		if _, err := os.Stat(dest); err != nil {
			break
		}
		dest = fmt.Sprintf("%s.%s-%d.bak", v.path, time.Now().Format(backupTimestampLayout), i)
	}
	if err := os.MkdirAll(filepath.Dir(dest), 0o700); err != nil {
		return "", fmt.Errorf("secretvault: preparing archive directory: %w", err)
	}
	if err := os.Rename(v.path, dest); err != nil {
		return "", fmt.Errorf("secretvault: archiving vault file: %w", err)
	}
	v.db = nil
	return dest, nil
}
