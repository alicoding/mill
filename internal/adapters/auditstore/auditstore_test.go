package auditstore

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/audit"
)

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

func TestStore_AppendAndList_NewestFirstAcrossKinds(t *testing.T) {
	store := openTestStore(t)
	kinds := []audit.Kind{audit.KindMCPCall, audit.KindSecretAccess, audit.KindBridgeCommand}
	for _, k := range kinds {
		if _, err := store.Append(context.Background(), audit.Entry{Kind: k, Action: "a"}); err != nil {
			t.Fatalf("Append(%s): %v", k, err)
		}
	}

	page, err := store.List(context.Background(), Filter{})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(page.Entries) != 3 {
		t.Fatalf("len(entries) = %d, want 3", len(page.Entries))
	}
	if page.Entries[0].Kind != audit.KindBridgeCommand || page.Entries[2].Kind != audit.KindMCPCall {
		t.Fatalf("entries not newest-first: %v", page.Entries)
	}
}

func TestStore_List_FiltersByKinds(t *testing.T) {
	store := openTestStore(t)
	must := func(k audit.Kind) {
		if _, err := store.Append(context.Background(), audit.Entry{Kind: k}); err != nil {
			t.Fatalf("Append: %v", err)
		}
	}
	must(audit.KindMCPCall)
	must(audit.KindSecretAccess)
	must(audit.KindMCPCall)

	page, err := store.List(context.Background(), Filter{Kinds: []audit.Kind{audit.KindMCPCall}})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(page.Entries) != 2 {
		t.Fatalf("kind filter: len(entries) = %d, want 2", len(page.Entries))
	}
	for _, e := range page.Entries {
		if e.Kind != audit.KindMCPCall {
			t.Fatalf("List(Kinds: [mcp-call]) returned a %q row", e.Kind)
		}
	}
}

func TestStore_List_CursorPagesForward(t *testing.T) {
	store := openTestStore(t)
	for i := 0; i < 5; i++ {
		if _, err := store.Append(context.Background(), audit.Entry{Kind: audit.KindMCPCall}); err != nil {
			t.Fatalf("Append: %v", err)
		}
	}
	page1, err := store.List(context.Background(), Filter{Limit: 2})
	if err != nil {
		t.Fatalf("List page1: %v", err)
	}
	if len(page1.Entries) != 2 || !page1.HasMore {
		t.Fatalf("page1 = %d entries, hasMore=%v; want 2/true", len(page1.Entries), page1.HasMore)
	}
	page2, err := store.List(context.Background(), Filter{Limit: 2, Cursor: page1.NextCursor})
	if err != nil {
		t.Fatalf("List page2: %v", err)
	}
	if len(page2.Entries) != 2 {
		t.Fatalf("page2 = %d entries, want 2", len(page2.Entries))
	}
	if page1.Entries[0].ID == page2.Entries[0].ID {
		t.Fatalf("page1 and page2 overlap at id %d", page1.Entries[0].ID)
	}
}

func TestStore_Prune_KeepsNewestAcrossEveryKind(t *testing.T) {
	store := openTestStore(t)
	for i := 0; i < 4; i++ {
		if _, err := store.Append(context.Background(), audit.Entry{Kind: audit.KindMCPCall}); err != nil {
			t.Fatalf("Append: %v", err)
		}
	}
	for i := 0; i < 4; i++ {
		if _, err := store.Append(context.Background(), audit.Entry{Kind: audit.KindSecretAccess}); err != nil {
			t.Fatalf("Append: %v", err)
		}
	}
	deleted, err := store.Prune(context.Background(), 3)
	if err != nil {
		t.Fatalf("Prune: %v", err)
	}
	if deleted != 5 {
		t.Fatalf("Prune deleted %d rows, want 5 (8 total - 3 kept)", deleted)
	}
	page, err := store.List(context.Background(), Filter{})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(page.Entries) != 3 {
		t.Fatalf("after prune: %d entries survive, want 3", len(page.Entries))
	}
}

func TestStore_Append_RejectsAttributeOutsideAllowlist(t *testing.T) {
	store := openTestStore(t)
	_, err := store.Append(context.Background(), audit.Entry{
		Kind: audit.KindSecretAccess, Attributes: map[string]string{"password": "x"},
	})
	if err == nil {
		t.Fatal("Append with a disallowed attribute key should fail, got nil error")
	}
}

func TestStore_Append_DefaultsZeroTimestampToNow(t *testing.T) {
	store := openTestStore(t)
	before := time.Now().Add(-time.Second)
	if _, err := store.Append(context.Background(), audit.Entry{Kind: audit.KindBridgeCommand}); err != nil {
		t.Fatalf("Append: %v", err)
	}
	page, err := store.List(context.Background(), Filter{})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(page.Entries) != 1 || page.Entries[0].Timestamp.Before(before) {
		t.Fatalf("entry timestamp = %v, want a timestamp at/after %v", page.Entries, before)
	}
}
