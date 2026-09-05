package secretvault

import (
	"path/filepath"
	"testing"

	"github.com/alicoding/mill/internal/domain/secret"
)

// An entry's kind and its source reference (goal 0306) survive the KDBX
// round trip as ordinary custom attributes, so a vault Mill wrote stays
// readable by foreign KDBX tooling and one edited there stays readable
// by Mill.
func TestUpsert_KindAndSourceRef_RoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "secrets.kdbx")
	v := New(path)
	key := testKey(t)
	if _, err := v.Create(key); err != nil {
		t.Fatalf("Create: %v", err)
	}

	pem, err := v.Upsert(secret.Entry{Title: "Signing key", Password: fixtureValueA, Kind: secret.KindKey})
	if err != nil {
		t.Fatalf("Upsert: %v", err)
	}
	backed, err := v.Upsert(secret.Entry{Title: "From the project env", Kind: secret.KindText, SourceRef: "env:proj/API_TOKEN"})
	if err != nil {
		t.Fatalf("Upsert source-backed: %v", err)
	}

	v.Lock()
	if err := v.Unlock(key); err != nil {
		t.Fatalf("Unlock: %v", err)
	}

	got, err := v.Get(pem.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.Kind != secret.KindKey || got.Password != fixtureValueA {
		t.Errorf("entry after reopen = %+v, want kind %q and its value", got, secret.KindKey)
	}
	src, err := v.Get(backed.ID)
	if err != nil {
		t.Fatalf("Get source-backed: %v", err)
	}
	if src.SourceRef != "env:proj/API_TOKEN" || src.Password != "" {
		t.Errorf("source-backed entry = %+v, want the reference and no value of its own", src)
	}

	list, err := v.List()
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	for _, s := range list {
		if s.ID == pem.ID && s.Kind != secret.KindKey {
			t.Errorf("summary kind = %q, want %q -- a kind-filtered picker reads the summary", s.Kind, secret.KindKey)
		}
	}
}

// An entry written before kinds existed, or by KeePassXC, carries no
// kind attribute and reads back as text rather than as an unusable
// blank.
func TestEntryToDomain_MissingKindAttribute_ReadsAsText(t *testing.T) {
	path := filepath.Join(t.TempDir(), "secrets.kdbx")
	v := New(path)
	key := testKey(t)
	if _, err := v.Create(key); err != nil {
		t.Fatalf("Create: %v", err)
	}
	created, err := v.Upsert(secret.Entry{Title: "Written elsewhere", Password: fixtureValueB})
	if err != nil {
		t.Fatalf("Upsert: %v", err)
	}
	// Strip the attribute the way a foreign writer's file would have it.
	fv, ok := v.(*fileVault)
	if !ok {
		t.Fatal("New did not return the file-backed vault")
	}
	fv.mu.Lock()
	entries := fv.db.Content.Root.Groups[0].Entries
	for i := range entries {
		if idx := entries[i].GetIndex(fieldKind); idx != -1 {
			entries[i].Values = append(entries[i].Values[:idx], entries[i].Values[idx+1:]...)
		}
	}
	fv.mu.Unlock()

	got, err := v.Get(created.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.Kind != secret.KindText {
		t.Errorf("entry with no kind attribute = %q, want %q", got.Kind, secret.KindText)
	}
}
