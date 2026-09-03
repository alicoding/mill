package secretauditstore

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/adapters/secretaudit"
)

// sqlOpen opens the raw database the way Open does, for building a
// pre-migration schema by hand.
func sqlOpen(dbPath string) (*sql.DB, error) { return sql.Open("sqlite", dbPath) }

func openTestStore(t *testing.T) *Store {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "execution.db")
	store, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}

func TestStore_InsertAndList_NewestFirst(t *testing.T) {
	store := openTestStore(t)

	base := time.Now().UTC()
	for i, label := range []string{"first", "second", "third"} {
		id, err := store.Insert(context.Background(), secretaudit.Record{
			Timestamp: base.Add(time.Duration(i) * time.Second), EntryID: "e1", Label: label,
			Context: secretaudit.ContextMCPServerSpawn, Outcome: secretaudit.OutcomeRead,
		})
		if err != nil {
			t.Fatalf("Insert(%s): %v", label, err)
		}
		if id <= 0 {
			t.Fatalf("Insert(%s): want a positive row id, got %d", label, id)
		}
	}

	records, total, err := store.List(Filter{}, 10, 0)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if total != 3 {
		t.Fatalf("total = %d, want 3", total)
	}
	if len(records) != 3 {
		t.Fatalf("len(records) = %d, want 3", len(records))
	}
	if records[0].Label != "third" || records[2].Label != "first" {
		t.Fatalf("records not newest-first: got %v, %v, %v", records[0].Label, records[1].Label, records[2].Label)
	}
}

func TestStore_List_FiltersByEntryID(t *testing.T) {
	store := openTestStore(t)
	must := func(r secretaudit.Record) {
		if _, err := store.Insert(context.Background(), r); err != nil {
			t.Fatalf("Insert: %v", err)
		}
	}
	must(secretaudit.Record{EntryID: "e1", Label: "GitHub PAT", Context: secretaudit.ContextUIReveal, Outcome: secretaudit.OutcomeRead})
	must(secretaudit.Record{EntryID: "e2", Label: "Bank Token", Context: secretaudit.ContextUICopy, Outcome: secretaudit.OutcomeRead})
	must(secretaudit.Record{EntryID: "e1", Label: "GitHub PAT", Context: secretaudit.ContextMCPServerSpawn, Outcome: secretaudit.OutcomeRead})

	byEntry, total, err := store.List(Filter{EntryID: "e1"}, 10, 0)
	if err != nil {
		t.Fatalf("List by entry: %v", err)
	}
	if total != 2 || len(byEntry) != 2 {
		t.Fatalf("entry=e1: total=%d len=%d, want 2/2", total, len(byEntry))
	}
	for _, r := range byEntry {
		if r.EntryID != "e1" {
			t.Fatalf("List(Filter{EntryID: e1}) returned a row for %q", r.EntryID)
		}
	}
}

func TestStore_List_LimitOffsetPages(t *testing.T) {
	store := openTestStore(t)
	for i := 0; i < 5; i++ {
		if _, err := store.Insert(context.Background(), secretaudit.Record{EntryID: "e1", Context: secretaudit.ContextExecEnv, Outcome: secretaudit.OutcomeRead}); err != nil {
			t.Fatalf("Insert: %v", err)
		}
	}
	page1, total, err := store.List(Filter{}, 2, 0)
	if err != nil || total != 5 || len(page1) != 2 {
		t.Fatalf("page1: err=%v total=%d len=%d, want nil/5/2", err, total, len(page1))
	}
	page2, _, err := store.List(Filter{}, 2, 2)
	if err != nil || len(page2) != 2 {
		t.Fatalf("page2: err=%v len=%d, want nil/2", err, len(page2))
	}
	if page1[0].ID == page2[0].ID {
		t.Fatalf("page1 and page2 overlap: both start at id %d", page1[0].ID)
	}
}

// TestStore_Prune_KeepsOnlyNewestN is the retention-cap proof, mirroring
// mcpauditstore's own parameterized-to-a-small-count shape.
func TestStore_Prune_KeepsOnlyNewestN(t *testing.T) {
	store := openTestStore(t)
	var lastFiveIDs []int64
	for i := 0; i < 8; i++ {
		id, err := store.Insert(context.Background(), secretaudit.Record{EntryID: "e1", Context: secretaudit.ContextHTTPHeader, Outcome: secretaudit.OutcomeRead})
		if err != nil {
			t.Fatalf("Insert: %v", err)
		}
		if i >= 3 {
			lastFiveIDs = append(lastFiveIDs, id)
		}
	}

	deleted, err := store.Prune(5)
	if err != nil {
		t.Fatalf("Prune: %v", err)
	}
	if deleted != 3 {
		t.Fatalf("Prune deleted %d rows, want 3", deleted)
	}

	records, total, err := store.List(Filter{}, 100, 0)
	if err != nil {
		t.Fatalf("List after prune: %v", err)
	}
	if total != 5 || len(records) != 5 {
		t.Fatalf("after prune: total=%d len=%d, want 5/5", total, len(records))
	}
	for _, r := range records {
		found := false
		for _, want := range lastFiveIDs {
			if r.ID == want {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("row id %d survived prune but wasn't one of the newest 5 (%v)", r.ID, lastFiveIDs)
		}
	}
}

func TestStore_Prune_NonPositiveKeepIsNoop(t *testing.T) {
	store := openTestStore(t)
	if _, err := store.Insert(context.Background(), secretaudit.Record{EntryID: "e1", Context: secretaudit.ContextUIReveal, Outcome: secretaudit.OutcomeRead}); err != nil {
		t.Fatalf("Insert: %v", err)
	}
	deleted, err := store.Prune(0)
	if err != nil || deleted != 0 {
		t.Fatalf("Prune(0): deleted=%d err=%v, want 0/nil", deleted, err)
	}
	_, total, _ := store.List(Filter{}, 10, 0)
	if total != 1 {
		t.Fatalf("total after Prune(0) = %d, want 1 (untouched)", total)
	}
}

func TestStore_Insert_RecordsErrorOutcomeWithTruncatedText(t *testing.T) {
	store := openTestStore(t)
	longText := make([]byte, secretaudit.ErrorTextCap+500)
	for i := range longText {
		longText[i] = 'x'
	}
	if _, err := store.Insert(context.Background(), secretaudit.Record{
		EntryID: "e1", Context: secretaudit.ContextExecEnv, Outcome: secretaudit.OutcomeError, ErrorText: string(longText),
	}); err != nil {
		t.Fatalf("Insert: %v", err)
	}
	records, _, err := store.List(Filter{}, 10, 0)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(records) != 1 || records[0].Outcome != secretaudit.OutcomeError {
		t.Fatalf("records = %+v, want one error-outcome row", records)
	}
	if len(records[0].ErrorText) != secretaudit.ErrorTextCap {
		t.Fatalf("ErrorText len = %d, want capped to %d", len(records[0].ErrorText), secretaudit.ErrorTextCap)
	}
}

// Actor (ADR-0048's plugin readers) round-trips, and a store created
// before the column existed is widened in place on open.
func TestStore_ActorRoundTripsAndOldSchemaIsWidened(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "execution.db")
	legacy, err := sqlOpen(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := legacy.ExecContext(context.Background(), `CREATE TABLE secret_access (
	id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, entry_id TEXT NOT NULL,
	label TEXT NOT NULL DEFAULT '', context TEXT NOT NULL, run_id TEXT NOT NULL DEFAULT '',
	workflow_id TEXT NOT NULL DEFAULT '', outcome TEXT NOT NULL, error_text TEXT NOT NULL DEFAULT '')`); err != nil {
		t.Fatal(err)
	}
	if _, err := legacy.ExecContext(context.Background(), `INSERT INTO secret_access (timestamp, entry_id, context, outcome) VALUES ('2026-01-01T00:00:00.000Z', 'old', 'ui-reveal', 'read')`); err != nil {
		t.Fatal(err)
	}
	_ = legacy.Close()

	store, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open on a pre-actor schema: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	if _, err := store.Insert(context.Background(), secretaudit.Record{EntryID: "e1", Context: secretaudit.ContextPluginFetch, Actor: "plugin:tester", Outcome: secretaudit.OutcomeRead}); err != nil {
		t.Fatal(err)
	}
	rows, total, err := store.List(Filter{}, 10, 0)
	if err != nil {
		t.Fatal(err)
	}
	if total != 2 || len(rows) != 2 {
		t.Fatalf("List = %d rows / total %d, want 2 / 2", len(rows), total)
	}
	if rows[0].Actor != "plugin:tester" || rows[1].Actor != "" {
		t.Errorf("actors = %q, %q; want plugin:tester then empty (legacy row)", rows[0].Actor, rows[1].Actor)
	}
}
