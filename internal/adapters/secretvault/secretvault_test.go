package secretvault

import (
	"path/filepath"
	"testing"

	"github.com/alicoding/mill/internal/domain/secret"
)

// fixtureValueA-E are stand-ins for a stored Password value --
// deliberately not password-shaped (no digit/letter mixing resembling
// a real credential) so a secret-shaped-fixture scanner has nothing to
// flag; the vault adapter itself treats a Password as an opaque
// string, so these values exercise exactly what a real password would.
const (
	fixtureValueA = "TESTFIXTUREVALUEALPHA"
	fixtureValueB = "TESTFIXTUREVALUEBETA"
	fixtureValueC = "TESTFIXTUREVALUEGAMMA"
	fixtureValueD = "TESTFIXTUREVALUEDELTA"
	fixtureValueE = "TESTFIXTUREVALUEEPSILON"
)

func testKey(t *testing.T) []byte {
	t.Helper()
	key, err := NewMasterKey()
	if err != nil {
		t.Fatalf("NewMasterKey: %v", err)
	}
	return key
}

func TestCreate_ThenReadBack_InMemory(t *testing.T) {
	path := filepath.Join(t.TempDir(), "secrets.kdbx")
	v := New(path)
	key := testKey(t)

	if v.Exists() {
		t.Fatal("Exists true before Create")
	}
	if _, err := v.Create(key); err != nil {
		t.Fatalf("Create: %v", err)
	}
	if !v.Exists() {
		t.Fatal("Exists false after Create")
	}
	if !v.Unlocked() {
		t.Fatal("Unlocked false right after Create")
	}

	created, err := v.Upsert(secret.Entry{Title: "Example entry", Username: "example-user", Password: fixtureValueA, URL: "https://example.test"})
	if err != nil {
		t.Fatalf("Upsert: %v", err)
	}
	if created.ID == "" {
		t.Fatal("Upsert did not mint an ID")
	}
	got, err := v.Get(created.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.Password != fixtureValueA {
		t.Fatalf("Get password = %q, want %q", got.Password, fixtureValueA)
	}
}

// TestPersistThenReopen proves the Lock->Encode->Unlock dance
// (persistLocked's own doc comment) actually round-trips a real
// protected value through a real file write and a FRESH decode -- the
// regression this pins: a naive Lock/Encode sequence corrupts the
// stream-cipher-protected Password field for every entry after the
// first if the in-memory db isn't correctly restored to plaintext
// between writes.
func TestPersistThenReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "secrets.kdbx")
	key := testKey(t)

	v := New(path)
	if _, err := v.Create(key); err != nil {
		t.Fatalf("Create: %v", err)
	}
	first, err := v.Upsert(secret.Entry{Title: "First", Password: fixtureValueA}) //nolint:gosec // fixture value, not a real credential (G101 false positive)
	if err != nil {
		t.Fatalf("Upsert first: %v", err)
	}
	// A second write exercises persistLocked twice in the same process --
	// the case that would surface a stream-cipher-position bug the first
	// write alone can't catch.
	second, err := v.Upsert(secret.Entry{Title: "Second", Password: fixtureValueB}) //nolint:gosec // fixture value, not a real credential (G101 false positive)
	if err != nil {
		t.Fatalf("Upsert second: %v", err)
	}

	// Fresh Vault instance, fresh decode from disk -- proves the FILE
	// itself is correct, not just this process's in-memory state.
	reopened := New(path)
	if err := reopened.Unlock(key); err != nil {
		t.Fatalf("Unlock reopened vault: %v", err)
	}
	gotFirst, err := reopened.Get(first.ID)
	if err != nil {
		t.Fatalf("Get first after reopen: %v", err)
	}
	if gotFirst.Password != fixtureValueA || gotFirst.Title != "First" {
		t.Fatalf("first entry after reopen = %+v, want Title=First Password=%s", gotFirst, fixtureValueA)
	}
	gotSecond, err := reopened.Get(second.ID)
	if err != nil {
		t.Fatalf("Get second after reopen: %v", err)
	}
	if gotSecond.Password != fixtureValueB || gotSecond.Title != "Second" {
		t.Fatalf("second entry after reopen = %+v, want Title=Second Password=%s", gotSecond, fixtureValueB)
	}
}

func TestUnlock_WrongKey(t *testing.T) {
	path := filepath.Join(t.TempDir(), "secrets.kdbx")
	v := New(path)
	if _, err := v.Create(testKey(t)); err != nil {
		t.Fatalf("Create: %v", err)
	}
	v2 := New(path)
	if err := v2.Unlock(testKey(t)); err == nil {
		t.Fatal("Unlock succeeded with the wrong key")
	}
}

func TestLock_ThenOperationsFail(t *testing.T) {
	path := filepath.Join(t.TempDir(), "secrets.kdbx")
	v := New(path)
	if _, err := v.Create(testKey(t)); err != nil {
		t.Fatalf("Create: %v", err)
	}
	v.Lock()
	if v.Unlocked() {
		t.Fatal("Unlocked true after Lock")
	}
	if _, err := v.List(); err != ErrLocked {
		t.Fatalf("List after Lock = %v, want ErrLocked", err)
	}
	if _, err := v.Upsert(secret.Entry{Title: "x"}); err != ErrLocked {
		t.Fatalf("Upsert after Lock = %v, want ErrLocked", err)
	}
}

func TestCreate_AlreadyExists(t *testing.T) {
	path := filepath.Join(t.TempDir(), "secrets.kdbx")
	v := New(path)
	if _, err := v.Create(testKey(t)); err != nil {
		t.Fatalf("Create: %v", err)
	}
	if _, err := New(path).Create(testKey(t)); err != ErrAlreadyExists {
		t.Fatalf("second Create = %v, want ErrAlreadyExists", err)
	}
}

func TestUpsert_UpdatePushesHistory(t *testing.T) {
	path := filepath.Join(t.TempDir(), "secrets.kdbx")
	v := New(path)
	if _, err := v.Create(testKey(t)); err != nil {
		t.Fatalf("Create: %v", err)
	}
	created, err := v.Upsert(secret.Entry{Title: "Site", Password: fixtureValueC}) //nolint:gosec // fixture value, not a real credential (G101 false positive)
	if err != nil {
		t.Fatalf("Upsert create: %v", err)
	}
	created.Password = fixtureValueD
	updated, err := v.Upsert(created)
	if err != nil {
		t.Fatalf("Upsert update: %v", err)
	}
	if updated.Password != fixtureValueD {
		t.Fatalf("updated password = %q, want %q", updated.Password, fixtureValueD)
	}
	hist, err := v.History(created.ID)
	if err != nil {
		t.Fatalf("History: %v", err)
	}
	if len(hist) != 1 {
		t.Fatalf("History length = %d, want 1", len(hist))
	}
	if hist[0].Password != fixtureValueC {
		t.Fatalf("history[0].Password = %q, want %q", hist[0].Password, fixtureValueC)
	}

	// A second update pushes a second history entry, most-recent first.
	updated.Password = fixtureValueE
	if _, err := v.Upsert(updated); err != nil {
		t.Fatalf("Upsert second update: %v", err)
	}
	hist, err = v.History(created.ID)
	if err != nil {
		t.Fatalf("History after second update: %v", err)
	}
	if len(hist) != 2 {
		t.Fatalf("History length = %d, want 2", len(hist))
	}
	if hist[0].Password != fixtureValueD || hist[1].Password != fixtureValueC {
		t.Fatalf("history order wrong: %+v", hist)
	}
}

func TestDelete(t *testing.T) {
	path := filepath.Join(t.TempDir(), "secrets.kdbx")
	v := New(path)
	if _, err := v.Create(testKey(t)); err != nil {
		t.Fatalf("Create: %v", err)
	}
	created, err := v.Upsert(secret.Entry{Title: "Gone"})
	if err != nil {
		t.Fatalf("Upsert: %v", err)
	}
	if err := v.Delete(created.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, err := v.Get(created.ID); err != ErrNotFound {
		t.Fatalf("Get after Delete = %v, want ErrNotFound", err)
	}
}

func TestList_SortedByTitle(t *testing.T) {
	path := filepath.Join(t.TempDir(), "secrets.kdbx")
	v := New(path)
	if _, err := v.Create(testKey(t)); err != nil {
		t.Fatalf("Create: %v", err)
	}
	for _, title := range []string{"Zebra", "Apple", "Mango"} {
		if _, err := v.Upsert(secret.Entry{Title: title}); err != nil {
			t.Fatalf("Upsert %q: %v", title, err)
		}
	}
	list, err := v.List()
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(list) != 3 {
		t.Fatalf("List length = %d, want 3", len(list))
	}
	if list[0].Title != "Apple" || list[1].Title != "Mango" || list[2].Title != "Zebra" {
		t.Fatalf("List order = %v", list)
	}
}
