package secretvault

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/secret"
	"github.com/tobischo/gokeepasslib/v3"
)

func TestTrashEntry_MovesToRecycleBin_HistoryAndMetaIntact(t *testing.T) {
	path := filepath.Join(t.TempDir(), "secrets.kdbx")
	v := New(path)
	if _, err := v.Create(testKey(t)); err != nil {
		t.Fatalf("Create: %v", err)
	}
	created, err := v.Upsert(secret.Entry{Title: "Site", Password: fixtureValueA}) //nolint:gosec // fixture value, not a real credential (G101 false positive)
	if err != nil {
		t.Fatalf("Upsert: %v", err)
	}
	created.Password = fixtureValueB
	updated, err := v.Upsert(created)
	if err != nil {
		t.Fatalf("Upsert update: %v", err)
	}

	if err := v.TrashEntry(updated.ID); err != nil {
		t.Fatalf("TrashEntry: %v", err)
	}

	// Excluded from every existing list/lookup path.
	if _, err := v.Get(updated.ID); err != ErrInTrash {
		t.Fatalf("Get after TrashEntry = %v, want ErrInTrash", err)
	}
	if _, err := v.History(updated.ID); err != ErrInTrash {
		t.Fatalf("History after TrashEntry = %v, want ErrInTrash", err)
	}
	list, err := v.List()
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(list) != 0 {
		t.Fatalf("List after TrashEntry = %v, want empty", list)
	}

	// History travels with the entry into the bin.
	trash, err := v.ListTrash()
	if err != nil {
		t.Fatalf("ListTrash: %v", err)
	}
	if len(trash) != 1 || trash[0].ID != updated.ID || trash[0].Title != "Site" {
		t.Fatalf("ListTrash = %+v, want one row for %q", trash, updated.ID)
	}
	if trash[0].DeletedAt.IsZero() {
		t.Fatal("ListTrash DeletedAt is zero")
	}

	fv := v.(*fileVault)
	if fv.db.Content.Meta.RecycleBinUUID.IsZero() {
		t.Fatal("Meta.RecycleBinUUID not set after TrashEntry")
	}
	if !fv.db.Content.Meta.RecycleBinEnabled.Bool {
		t.Fatal("Meta.RecycleBinEnabled not set after TrashEntry")
	}
	binIdx := fv.findRecycleBinIndexLocked()
	if binIdx == -1 {
		t.Fatal("no Recycle Bin group found")
	}
	bin := fv.db.Content.Root.Groups[binIdx]
	if bin.Name != recycleBinGroupName {
		t.Fatalf("bin group name = %q, want %q", bin.Name, recycleBinGroupName)
	}
	if len(bin.Entries) != 1 {
		t.Fatalf("bin group entries = %d, want 1", len(bin.Entries))
	}
	if len(bin.Entries[0].Histories) == 0 || len(bin.Entries[0].Histories[0].Entries) == 0 {
		t.Fatal("trashed entry lost its history")
	}
}

// TestTrashEntry_BinUUID_ReadBackLikeAnotherKDBXClient proves the bin
// is discoverable the way a foreign KeePassXC reader actually finds
// it: decode a fresh Database from the written file and follow
// Meta.RecycleBinUUID to a real group in the tree, never a Mill-only
// shortcut.
func TestTrashEntry_BinUUID_ReadBackLikeAnotherKDBXClient(t *testing.T) {
	path := filepath.Join(t.TempDir(), "secrets.kdbx")
	key := testKey(t)
	v := New(path)
	if _, err := v.Create(key); err != nil {
		t.Fatalf("Create: %v", err)
	}
	created, err := v.Upsert(secret.Entry{Title: "Site"})
	if err != nil {
		t.Fatalf("Upsert: %v", err)
	}
	if err := v.TrashEntry(created.ID); err != nil {
		t.Fatalf("TrashEntry: %v", err)
	}

	reader, err := os.Open(path) //nolint:gosec // path is this test's own tempdir vault file
	if err != nil {
		t.Fatalf("open vault file: %v", err)
	}
	defer func() { _ = reader.Close() }()
	creds, err := gokeepasslib.NewKeyDataCredentials(key)
	if err != nil {
		t.Fatalf("NewKeyDataCredentials: %v", err)
	}
	db := gokeepasslib.NewDatabase()
	db.Credentials = creds
	if err := gokeepasslib.NewDecoder(reader).Decode(db); err != nil {
		t.Fatalf("decode vault: %v", err)
	}

	if db.Content.Meta.RecycleBinUUID.IsZero() {
		t.Fatal("a foreign decode sees no RecycleBinUUID")
	}
	var found bool
	for _, g := range db.Content.Root.Groups {
		if g.UUID.Compare(db.Content.Meta.RecycleBinUUID) {
			found = true
			if g.Name != recycleBinGroupName || len(g.Entries) != 1 {
				t.Fatalf("bin group = %+v, want name %q with 1 entry", g, recycleBinGroupName)
			}
		}
	}
	if !found {
		t.Fatal("Meta.RecycleBinUUID names no group a foreign decode can find")
	}
}

func TestRestoreEntry_BackToOriginalGroup(t *testing.T) {
	path := filepath.Join(t.TempDir(), "secrets.kdbx")
	v := New(path)
	if _, err := v.Create(testKey(t)); err != nil {
		t.Fatalf("Create: %v", err)
	}
	created, err := v.Upsert(secret.Entry{Title: "Site", Password: fixtureValueC}) //nolint:gosec // fixture value, not a real credential (G101 false positive)
	if err != nil {
		t.Fatalf("Upsert: %v", err)
	}
	if err := v.TrashEntry(created.ID); err != nil {
		t.Fatalf("TrashEntry: %v", err)
	}
	if err := v.RestoreEntry(created.ID); err != nil {
		t.Fatalf("RestoreEntry: %v", err)
	}

	got, err := v.Get(created.ID)
	if err != nil {
		t.Fatalf("Get after RestoreEntry: %v", err)
	}
	if got.Title != "Site" || got.Password != fixtureValueC {
		t.Fatalf("restored entry = %+v", got)
	}
	trash, err := v.ListTrash()
	if err != nil {
		t.Fatalf("ListTrash: %v", err)
	}
	if len(trash) != 0 {
		t.Fatalf("ListTrash after restore = %v, want empty", trash)
	}
}

func TestDestroyEntry_PermanentlyRemoves(t *testing.T) {
	path := filepath.Join(t.TempDir(), "secrets.kdbx")
	v := New(path)
	if _, err := v.Create(testKey(t)); err != nil {
		t.Fatalf("Create: %v", err)
	}
	created, err := v.Upsert(secret.Entry{Title: "Gone forever"})
	if err != nil {
		t.Fatalf("Upsert: %v", err)
	}

	// DestroyEntry refuses an id that isn't trashed yet.
	if err := v.DestroyEntry(created.ID); err != ErrNotFound {
		t.Fatalf("DestroyEntry on a live entry = %v, want ErrNotFound", err)
	}

	if err := v.TrashEntry(created.ID); err != nil {
		t.Fatalf("TrashEntry: %v", err)
	}
	if err := v.DestroyEntry(created.ID); err != nil {
		t.Fatalf("DestroyEntry: %v", err)
	}
	if _, err := v.Get(created.ID); err != ErrNotFound {
		t.Fatalf("Get after DestroyEntry = %v, want ErrNotFound", err)
	}
	trash, err := v.ListTrash()
	if err != nil {
		t.Fatalf("ListTrash: %v", err)
	}
	if len(trash) != 0 {
		t.Fatalf("ListTrash after destroy = %v, want empty", trash)
	}
}

func TestSweepTrash_DestroysOnlyPastRetention(t *testing.T) {
	path := filepath.Join(t.TempDir(), "secrets.kdbx")
	v := New(path)
	if _, err := v.Create(testKey(t)); err != nil {
		t.Fatalf("Create: %v", err)
	}
	old, err := v.Upsert(secret.Entry{Title: "Old"})
	if err != nil {
		t.Fatalf("Upsert old: %v", err)
	}
	recent, err := v.Upsert(secret.Entry{Title: "Recent"})
	if err != nil {
		t.Fatalf("Upsert recent: %v", err)
	}
	if err := v.TrashEntry(old.ID); err != nil {
		t.Fatalf("TrashEntry old: %v", err)
	}
	if err := v.TrashEntry(recent.ID); err != nil {
		t.Fatalf("TrashEntry recent: %v", err)
	}

	retention := 30 * 24 * time.Hour
	now := time.Now()

	// A sweep run right now destroys neither: both were just trashed.
	destroyed, err := v.SweepTrash(now, retention)
	if err != nil {
		t.Fatalf("SweepTrash (nothing due): %v", err)
	}
	if len(destroyed) != 0 {
		t.Fatalf("SweepTrash destroyed %v, want none", destroyed)
	}

	// An injected "now" 31 days later destroys both.
	future := now.Add(31 * 24 * time.Hour)
	destroyed, err = v.SweepTrash(future, retention)
	if err != nil {
		t.Fatalf("SweepTrash (both due): %v", err)
	}
	if len(destroyed) != 2 {
		t.Fatalf("SweepTrash destroyed %d, want 2", len(destroyed))
	}
	trash, err := v.ListTrash()
	if err != nil {
		t.Fatalf("ListTrash: %v", err)
	}
	if len(trash) != 0 {
		t.Fatalf("ListTrash after sweep = %v, want empty", trash)
	}
}

func TestTrashEntry_Idempotent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "secrets.kdbx")
	v := New(path)
	if _, err := v.Create(testKey(t)); err != nil {
		t.Fatalf("Create: %v", err)
	}
	created, err := v.Upsert(secret.Entry{Title: "Twice"})
	if err != nil {
		t.Fatalf("Upsert: %v", err)
	}
	if err := v.TrashEntry(created.ID); err != nil {
		t.Fatalf("first TrashEntry: %v", err)
	}
	if err := v.TrashEntry(created.ID); err != nil {
		t.Fatalf("second TrashEntry: %v", err)
	}
	trash, err := v.ListTrash()
	if err != nil {
		t.Fatalf("ListTrash: %v", err)
	}
	if len(trash) != 1 {
		t.Fatalf("ListTrash after double-trash = %v, want exactly one row", trash)
	}
}
