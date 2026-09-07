package mcpauditstore

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/alicoding/mill/internal/adapters/auditstore"
	"github.com/alicoding/mill/internal/adapters/mcpaudit"
	"github.com/alicoding/mill/internal/domain/audit"
)

// TestOpen_MigratesLegacyMCPCallsTableOnce is the goal 0351 Decision 2
// proof: a pre-goal-0351 mcp_calls table's rows survive into the shared
// store, the legacy table is dropped, and calling Open again on the
// same file is a no-op (idempotent) rather than duplicating rows.
func TestOpen_MigratesLegacyMCPCallsTableOnce(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "execution.db")
	legacy, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := legacy.ExecContext(context.Background(), `CREATE TABLE mcp_calls (
	id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, direction TEXT NOT NULL,
	session_id TEXT NOT NULL DEFAULT '', method_name TEXT NOT NULL, tool_name TEXT NOT NULL DEFAULT '',
	caller_identity TEXT NOT NULL DEFAULT '', outcome TEXT NOT NULL, duration_ms INTEGER NOT NULL DEFAULT 0,
	error_text TEXT NOT NULL DEFAULT '', arg_bytes INTEGER NOT NULL DEFAULT 0, parked_write_id TEXT NOT NULL DEFAULT '')`); err != nil {
		t.Fatal(err)
	}
	if _, err := legacy.ExecContext(context.Background(),
		`INSERT INTO mcp_calls (timestamp, direction, method_name, tool_name, caller_identity, outcome, duration_ms)
		 VALUES ('2026-01-01T00:00:00.000Z', 'server', 'tools/call', 'legacy_tool', 'legacy-client/1.0', 'success', 42)`); err != nil {
		t.Fatal(err)
	}
	if _, err := legacy.ExecContext(context.Background(), `INSERT INTO mcp_calls (timestamp, direction, method_name, tool_name, caller_identity, outcome, duration_ms)
		 VALUES ('2026-01-01T00:00:01.000Z', 'client', 'tools/call', 'legacy_tool_2', 'agentloop-sess-1', 'success', 7)`); err != nil {
		t.Fatal(err)
	}
	if err := legacy.Close(); err != nil {
		t.Fatal(err)
	}

	store, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open on a pre-migration schema: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	records, total, err := store.List(Filter{}, 10, 0)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if total != 2 || len(records) != 2 {
		t.Fatalf("List after migration = %d rows / total %d, want 2 / 2", len(records), total)
	}
	// Oldest legacy row migrated last (newest-first List): index 1.
	if records[1].ToolName != "legacy_tool" || records[1].CallerIdentity != "legacy-client/1.0" || records[1].DurationMS != 42 {
		t.Errorf("first migrated row = %+v, want the server-direction legacy row intact", records[1])
	}
	if records[0].ToolName != "legacy_tool_2" || records[0].CallerIdentity != "agentloop-sess-1" {
		t.Errorf("second migrated row = %+v, want the agentloop legacy row intact", records[0])
	}

	exists, err := auditstore.TableExists(store.db, "mcp_calls")
	if err != nil {
		t.Fatal(err)
	}
	if exists {
		t.Error("mcp_calls should be dropped after migration")
	}

	// Idempotent: a second Open on the same file must not re-migrate or
	// duplicate rows (mcp_calls no longer exists).
	store2, err := Open(dbPath)
	if err != nil {
		t.Fatalf("second Open: %v", err)
	}
	t.Cleanup(func() { _ = store2.Close() })
	_, total2, err := store2.List(Filter{}, 10, 0)
	if err != nil {
		t.Fatalf("List after second Open: %v", err)
	}
	if total2 != 2 {
		t.Fatalf("total after a second Open = %d, want 2 (migration must be idempotent)", total2)
	}
}

// TestToEntry_ProducesOnlyAllowedAttributeKeys is goal 0351 Decision
// 1's enumeration proof for this producer: a fully-populated Record's
// mapped Entry never carries an Attributes key outside mcp-call's own
// allowlist.
func TestToEntry_ProducesOnlyAllowedAttributeKeys(t *testing.T) {
	r := mcpaudit.Record{
		Direction: mcpaudit.DirectionClient, SessionID: "sess-1", MethodName: "tools/call", ToolName: "t",
		CallerIdentity: "step-1", Outcome: mcpaudit.OutcomeParked, DurationMS: 5, ErrorText: "boom",
		ArgBytes: 10, ParkedWriteID: "write-1",
	}
	e := toEntry(r)
	if err := audit.ValidateAttributes(e.Kind, e.Attributes); err != nil {
		t.Fatalf("toEntry produced a disallowed attribute key: %v", err)
	}
	if len(e.Attributes) == 0 {
		t.Fatal("expected at least one attribute for a fully-populated Record")
	}
}
