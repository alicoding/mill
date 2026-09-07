package secretauditstore

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/alicoding/mill/internal/adapters/auditstore"
	"github.com/alicoding/mill/internal/adapters/secretaudit"
	"github.com/alicoding/mill/internal/domain/audit"
)

// TestOpen_MigratesLegacySecretAccessTableOnce is the goal 0351
// Decision 2 proof: a pre-goal-0351 secret_access table (full modern
// shape, including actor/step_id/failure_kind) migrates into the
// shared store, the legacy table is dropped, and a second Open on the
// same file is idempotent rather than duplicating rows.
func TestOpen_MigratesLegacySecretAccessTableOnce(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "execution.db")
	legacy, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := legacy.ExecContext(context.Background(), `CREATE TABLE secret_access (
	id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, entry_id TEXT NOT NULL,
	label TEXT NOT NULL DEFAULT '', context TEXT NOT NULL, run_id TEXT NOT NULL DEFAULT '',
	workflow_id TEXT NOT NULL DEFAULT '', actor TEXT NOT NULL DEFAULT '', outcome TEXT NOT NULL,
	error_text TEXT NOT NULL DEFAULT '', step_id TEXT NOT NULL DEFAULT '', failure_kind TEXT NOT NULL DEFAULT '')`); err != nil {
		t.Fatal(err)
	}
	if _, err := legacy.ExecContext(context.Background(),
		`INSERT INTO secret_access (timestamp, entry_id, label, context, actor, outcome)
		 VALUES ('2026-01-01T00:00:00.000Z', 'legacy-entry', 'Legacy Secret', 'ui-reveal', 'plugin:legacy', 'read')`); err != nil {
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
	if total != 1 || len(records) != 1 {
		t.Fatalf("List after migration = %d rows / total %d, want 1 / 1", len(records), total)
	}
	if records[0].EntryID != "legacy-entry" || records[0].Label != "Legacy Secret" || records[0].Actor != "plugin:legacy" {
		t.Errorf("migrated row = %+v, want the legacy row intact", records[0])
	}

	exists, err := auditstore.TableExists(store.db, "secret_access")
	if err != nil {
		t.Fatal(err)
	}
	if exists {
		t.Error("secret_access should be dropped after migration")
	}

	store2, err := Open(dbPath)
	if err != nil {
		t.Fatalf("second Open: %v", err)
	}
	t.Cleanup(func() { _ = store2.Close() })
	_, total2, err := store2.List(Filter{}, 10, 0)
	if err != nil {
		t.Fatalf("List after second Open: %v", err)
	}
	if total2 != 1 {
		t.Fatalf("total after a second Open = %d, want 1 (migration must be idempotent)", total2)
	}
}

// TestToEntry_ProducesOnlyAllowedAttributeKeys is goal 0351 Decision
// 1's enumeration proof for this producer.
func TestToEntry_ProducesOnlyAllowedAttributeKeys(t *testing.T) {
	r := secretaudit.Record{
		EntryID: "e1", Label: "L", Context: secretaudit.ContextPluginFetch, RunID: "run-1", WorkflowID: "wf-1",
		StepID: "step-1", Actor: "plugin:tester", Outcome: secretaudit.OutcomeError,
		FailureKind: secretaudit.FailureKindOther, ErrorText: "boom",
	}
	e := toEntry(r)
	if err := audit.ValidateAttributes(e.Kind, e.Attributes); err != nil {
		t.Fatalf("toEntry produced a disallowed attribute key: %v", err)
	}
}
