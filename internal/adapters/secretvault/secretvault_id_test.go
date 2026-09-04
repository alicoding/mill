package secretvault

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/domain/secret"
)

// A created vault carries an identity in its plaintext header, readable
// without the master key and stable across a save (goal 0330).
func TestCreateWritesReadableVaultID(t *testing.T) {
	path := filepath.Join(t.TempDir(), "secrets.kdbx")
	v := New(path)
	id, err := v.Create(testKey(t))
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if id == "" {
		t.Fatal("Create returned an empty vault id")
	}

	// Read the id back through a SEPARATE handle that never holds the
	// key -- the property the binding depends on.
	read, err := New(path).ID()
	if err != nil {
		t.Fatalf("ID: %v", err)
	}
	if read != id {
		t.Fatalf("ID = %q, want %q", read, id)
	}

	// A write through the ordinary save path must preserve it.
	if _, err := v.Upsert(secret.Entry{Title: "After id"}); err != nil {
		t.Fatalf("Upsert: %v", err)
	}
	after, err := New(path).ID()
	if err != nil {
		t.Fatalf("ID after save: %v", err)
	}
	if after != id {
		t.Fatalf("id after save = %q, want %q", after, id)
	}
}

// Two vaults created on the same machine get different identities --
// what keeps their stored keys from colliding.
func TestCreateMintsDistinctVaultIDs(t *testing.T) {
	dir := t.TempDir()
	first, err := New(filepath.Join(dir, "a.kdbx")).Create(testKey(t))
	if err != nil {
		t.Fatalf("Create a: %v", err)
	}
	second, err := New(filepath.Join(dir, "b.kdbx")).Create(testKey(t))
	if err != nil {
		t.Fatalf("Create b: %v", err)
	}
	if first == second {
		t.Fatalf("both vaults minted id %q", first)
	}
}

// A vault file written before the identity header reads as "" rather
// than an error, and AssignID stamps one in place.
func TestAssignIDStampsLegacyVault(t *testing.T) {
	path := filepath.Join(t.TempDir(), "secrets.kdbx")
	key := testKey(t)
	v := New(path)
	if _, err := v.Create(key); err != nil {
		t.Fatalf("Create: %v", err)
	}
	stripVaultID(t, path, key)

	if id, err := New(path).ID(); err != nil || id != "" {
		t.Fatalf("ID of stripped vault = %q, %v; want \"\", nil", id, err)
	}

	legacy := New(path)
	if err := legacy.Unlock(key); err != nil {
		t.Fatalf("Unlock: %v", err)
	}
	assigned, err := legacy.AssignID()
	if err != nil {
		t.Fatalf("AssignID: %v", err)
	}
	if assigned == "" {
		t.Fatal("AssignID returned an empty id")
	}
	// Written immediately, not deferred to the next ordinary save.
	onDisk, err := New(path).ID()
	if err != nil {
		t.Fatalf("ID after AssignID: %v", err)
	}
	if onDisk != assigned {
		t.Fatalf("on-disk id = %q, want %q", onDisk, assigned)
	}
	// Idempotent: a second call keeps the id already in force.
	again, err := legacy.AssignID()
	if err != nil || again != assigned {
		t.Fatalf("second AssignID = %q, %v; want %q, nil", again, err, assigned)
	}
}

func TestAssignIDRequiresUnlocked(t *testing.T) {
	path := filepath.Join(t.TempDir(), "secrets.kdbx")
	v := New(path)
	if _, err := v.Create(testKey(t)); err != nil {
		t.Fatalf("Create: %v", err)
	}
	v.Lock()
	if _, err := v.AssignID(); err != ErrLocked {
		t.Fatalf("AssignID on a locked vault = %v, want ErrLocked", err)
	}
}

// Backup moves the file aside under a .bak name and leaves nothing at
// the original path for Create to trip over.
func TestBackupArchivesTheFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "secrets.kdbx")
	v := New(path)
	if _, err := v.Create(testKey(t)); err != nil {
		t.Fatalf("Create: %v", err)
	}
	archived, err := v.Backup()
	if err != nil {
		t.Fatalf("Backup: %v", err)
	}
	if !strings.HasSuffix(archived, ".bak") || filepath.Dir(archived) != dir {
		t.Fatalf("archived at %q, want a .bak sibling in %q", archived, dir)
	}
	if _, err := os.Stat(archived); err != nil {
		t.Fatalf("archived file missing: %v", err)
	}
	if v.Exists() {
		t.Fatal("vault file still present at the original path after Backup")
	}
	if v.Unlocked() {
		t.Fatal("vault still unlocked after Backup")
	}
	if _, err := v.Create(testKey(t)); err != nil {
		t.Fatalf("Create after Backup: %v", err)
	}
}

// stripVaultID rewrites path's vault without the identity header,
// standing in for a file written before goal 0330.
func stripVaultID(t *testing.T, path string, key []byte) {
	t.Helper()
	v := New(path).(*fileVault)
	if err := v.Unlock(key); err != nil {
		t.Fatalf("stripVaultID unlock: %v", err)
	}
	v.mu.Lock()
	v.db.Header.FileHeaders.PublicCustomData = nil
	err := v.persistLocked()
	v.mu.Unlock()
	if err != nil {
		t.Fatalf("stripVaultID persist: %v", err)
	}
	v.Lock()
}
