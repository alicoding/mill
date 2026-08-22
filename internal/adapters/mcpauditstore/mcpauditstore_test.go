package mcpauditstore

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/adapters/mcpaudit"
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

func TestStore_InsertAndList_NewestFirst(t *testing.T) {
	store := openTestStore(t)

	base := time.Now().UTC()
	for i, tool := range []string{"first_tool", "second_tool", "third_tool"} {
		id, err := store.Insert(context.Background(), mcpaudit.Record{
			Timestamp: base.Add(time.Duration(i) * time.Second), Direction: mcpaudit.DirectionServer,
			SessionID: "sess-1", MethodName: "tools/call", ToolName: tool, CallerIdentity: "test-client/1.0",
			Outcome: mcpaudit.OutcomeSuccess, DurationMS: 10,
		})
		if err != nil {
			t.Fatalf("Insert(%s): %v", tool, err)
		}
		if id <= 0 {
			t.Fatalf("Insert(%s): want a positive row id, got %d", tool, id)
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
	// Newest first: third_tool was inserted last.
	if records[0].ToolName != "third_tool" || records[2].ToolName != "first_tool" {
		t.Fatalf("records not newest-first: got %v, %v, %v", records[0].ToolName, records[1].ToolName, records[2].ToolName)
	}
}

func TestStore_List_FiltersByDirectionAndTool(t *testing.T) {
	store := openTestStore(t)
	must := func(r mcpaudit.Record) {
		if _, err := store.Insert(context.Background(), r); err != nil {
			t.Fatalf("Insert: %v", err)
		}
	}
	must(mcpaudit.Record{Direction: mcpaudit.DirectionServer, MethodName: "tools/call", ToolName: "alpha", Outcome: mcpaudit.OutcomeSuccess})
	must(mcpaudit.Record{Direction: mcpaudit.DirectionClient, MethodName: "tools/call", ToolName: "alpha", Outcome: mcpaudit.OutcomeSuccess})
	must(mcpaudit.Record{Direction: mcpaudit.DirectionServer, MethodName: "tools/call", ToolName: "beta", Outcome: mcpaudit.OutcomeError})

	byDirection, total, err := store.List(Filter{Direction: mcpaudit.DirectionServer}, 10, 0)
	if err != nil {
		t.Fatalf("List by direction: %v", err)
	}
	if total != 2 || len(byDirection) != 2 {
		t.Fatalf("direction=server: total=%d len=%d, want 2/2", total, len(byDirection))
	}

	byTool, total, err := store.List(Filter{Tool: "beta"}, 10, 0)
	if err != nil {
		t.Fatalf("List by tool: %v", err)
	}
	if total != 1 || len(byTool) != 1 || byTool[0].ToolName != "beta" {
		t.Fatalf("tool=beta: total=%d records=%v, want exactly the beta row", total, byTool)
	}
}

func TestStore_List_LimitOffsetPages(t *testing.T) {
	store := openTestStore(t)
	for i := 0; i < 5; i++ {
		if _, err := store.Insert(context.Background(), mcpaudit.Record{Direction: mcpaudit.DirectionServer, MethodName: "tools/call", ToolName: "t", Outcome: mcpaudit.OutcomeSuccess}); err != nil {
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

// TestStore_Prune_KeepsOnlyNewestN is the retention-cap proof the design
// contract requires (keep the newest 10,000, prune at boot) --
// parameterized to a small keep count rather than literally inserting
// 10,001 rows, since Prune's own SQL has no dependency on the specific
// number.
func TestStore_Prune_KeepsOnlyNewestN(t *testing.T) {
	store := openTestStore(t)
	var lastFiveIDs []int64
	for i := 0; i < 8; i++ {
		id, err := store.Insert(context.Background(), mcpaudit.Record{Direction: mcpaudit.DirectionServer, MethodName: "tools/call", ToolName: "t", Outcome: mcpaudit.OutcomeSuccess})
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
	if _, err := store.Insert(context.Background(), mcpaudit.Record{Direction: mcpaudit.DirectionServer, MethodName: "tools/call", Outcome: mcpaudit.OutcomeSuccess}); err != nil {
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

func TestStore_UpdateOutcome_MutatesMostRecentParkedRowForWriteID(t *testing.T) {
	store := openTestStore(t)
	id, err := store.Insert(context.Background(), mcpaudit.Record{
		Direction: mcpaudit.DirectionServer, MethodName: "tools/call", ToolName: "create_atlas_card",
		Outcome: mcpaudit.OutcomeParked, ParkedWriteID: "write-123",
	})
	if err != nil {
		t.Fatalf("Insert: %v", err)
	}

	if err := store.UpdateOutcome("write-123", mcpaudit.OutcomeParkedApproved, ""); err != nil {
		t.Fatalf("UpdateOutcome: %v", err)
	}

	records, _, err := store.List(Filter{}, 10, 0)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(records) != 1 || records[0].ID != id || records[0].Outcome != mcpaudit.OutcomeParkedApproved {
		t.Fatalf("row after UpdateOutcome = %+v, want outcome=parked_approved on id %d", records, id)
	}
}

func TestStore_UpdateOutcome_UnknownWriteIDIsNoop(t *testing.T) {
	store := openTestStore(t)
	if err := store.UpdateOutcome("no-such-write", mcpaudit.OutcomeParkedExpired, "expired"); err != nil {
		t.Fatalf("UpdateOutcome on unknown write id should be a no-op, got: %v", err)
	}
}
