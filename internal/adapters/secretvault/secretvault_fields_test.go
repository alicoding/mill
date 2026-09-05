package secretvault

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/domain/secret"
	"github.com/tobischo/gokeepasslib/v3"
)

// An entry's own fields and tags (goal 0306 S4) survive the KDBX round
// trip as ordinary custom strings and the standard Tags value, so a
// vault Mill wrote stays readable by foreign KDBX tooling. A protected
// field carries the same protected flag the password does.
func TestUpsert_FieldsAndTags_RoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "secrets.kdbx")
	v := New(path)
	key := testKey(t)
	if _, err := v.Create(key); err != nil {
		t.Fatalf("Create: %v", err)
	}
	created, err := v.Upsert(secret.Entry{
		Title: "Router", Password: fixtureValueA, Kind: secret.KindText,
		Tags: []string{"home", "network"},
		Fields: []secret.Field{
			{Name: "Serial", Value: "SN-1234"},
			{Name: "Recovery code", Value: "r3c0v3ry", Protected: true},
		},
	})
	if err != nil {
		t.Fatalf("Upsert: %v", err)
	}

	v.Lock()
	if err := v.Unlock(key); err != nil {
		t.Fatalf("Unlock: %v", err)
	}
	got, err := v.Get(created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(got.Tags, ",") != "home,network" {
		t.Errorf("tags = %v", got.Tags)
	}
	if len(got.Fields) != 2 {
		t.Fatalf("fields = %+v", got.Fields)
	}
	byName := map[string]secret.Field{}
	for _, f := range got.Fields {
		byName[f.Name] = f
	}
	if byName["Serial"].Value != "SN-1234" || byName["Serial"].Protected {
		t.Errorf("serial = %+v", byName["Serial"])
	}
	if byName["Recovery code"].Value != "r3c0v3ry" || !byName["Recovery code"].Protected {
		t.Errorf("recovery = %+v", byName["Recovery code"])
	}
	// The summary carries the field NAMES and no values, so a browse
	// surface can search them without a reveal.
	summary := got.ToSummary()
	if strings.Join(summary.FieldNames, ",") != "Recovery code,Serial" {
		t.Errorf("summary field names = %v", summary.FieldNames)
	}

	assertRemovingAFieldRemovesIt(t, v, got)
}

// A dropped field must leave the FILE, not just the caller's slice:
// otherwise the next read resurrects a value the reader deleted.
func assertRemovingAFieldRemovesIt(t *testing.T, v Vault, entry secret.Entry) {
	t.Helper()
	entry.Fields = []secret.Field{{Name: "Serial", Value: "SN-9999"}}
	entry.Tags = []string{"home"}
	if _, err := v.Upsert(entry); err != nil {
		t.Fatal(err)
	}
	after, err := v.Get(entry.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(after.Fields) != 1 || after.Fields[0].Value != "SN-9999" || strings.Join(after.Tags, ",") != "home" {
		t.Fatalf("after edit = %+v tags=%v", after.Fields, after.Tags)
	}
}

// Mill's own attributes and the entry's own columns are never listed
// back as custom fields, whatever else the file holds.
func TestCustomFields_NeverListMillsOwnAttributes(t *testing.T) {
	entry := gokeepasslib.NewEntry()
	applyValues(&entry, secret.Entry{
		Title: "T", Username: "u", Password: "p", URL: "url", Notes: "n",
		Tags: []string{"x"}, Kind: secret.KindText, SourceRef: "env:s/K", Origin: "import:a.csv",
		Fields: []secret.Field{{Name: "Own", Value: "v"}},
	})
	fields := customFields(entry)
	if len(fields) != 1 || fields[0].Name != "Own" {
		t.Fatalf("fields = %+v", fields)
	}
}

// An entry authored before fields existed, or by another KDBX editor
// that writes no Tags value, still reads back cleanly.
func TestEntryToDomain_ToleratesAnEntryWithoutTagsOrFields(t *testing.T) {
	entry := gokeepasslib.NewEntry()
	setValue(&entry, fieldTitle, "Old", false)
	got := entryToDomain(entry)
	if len(got.Tags) != 0 || len(got.Fields) != 0 || got.Title != "Old" {
		t.Fatalf("got = %+v", got)
	}
}
