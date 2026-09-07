package secretauditstore

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/alicoding/mill/internal/adapters/auditstore"
	"github.com/alicoding/mill/internal/adapters/secretaudit"
)

// legacyTimestampLayout mirrors this package's own pre-goal-0351
// timestamp encoding (RFC3339Nano in UTC), needed only to parse a
// legacy secret_access row's timestamp column during migration.
const legacyTimestampLayout = time.RFC3339Nano

// migrateLegacyTable copies every row of the pre-goal-0351
// secret_access table into the shared audit_entries table, then drops
// secret_access -- goal 0351 Decision 2's one-time migration.
// Idempotent: a no-op the moment secret_access no longer exists. A
// secret_access table predating actor/step_id/failure_kind (goal
// 0371/0378's own widen-in-place columns) is widened to the full
// legacy shape FIRST (ensureLegacySchema, this package's original
// widen-in-place logic, kept for this one purpose), so every row reads
// back with the same defaults ("") the old adapter always produced for
// a column that didn't exist yet when that row was written. Runs
// inside one transaction so a crash mid-migration never leaves
// duplicated rows on the next Open.
func migrateLegacyTable(db *sql.DB) error {
	exists, err := auditstore.TableExists(db, "secret_access")
	if err != nil {
		return err
	}
	if !exists {
		return nil
	}
	if err := ensureLegacySchema(db); err != nil {
		return err
	}

	ctx := context.Background()
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("secretauditstore: migrate: begin: %w", err)
	}
	legacyRows, err := readLegacyRows(ctx, tx)
	if err != nil {
		_ = tx.Rollback()
		return err
	}
	for _, r := range legacyRows {
		if _, err := auditstore.InsertEntry(ctx, tx, toEntry(r)); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("secretauditstore: migrate: insert: %w", err)
		}
	}
	if _, err := tx.ExecContext(ctx, "DROP TABLE secret_access"); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("secretauditstore: migrate: drop: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("secretauditstore: migrate: commit: %w", err)
	}
	return nil
}

// readLegacyRows selects every secret_access row, oldest first, so the
// migrated rows land in audit_entries in their original relative order.
// Only callable after ensureLegacySchema, so every column below is
// guaranteed to exist.
func readLegacyRows(ctx context.Context, tx *sql.Tx) ([]secretaudit.Record, error) {
	rows, err := tx.QueryContext(ctx, `SELECT id, timestamp, entry_id, label, context, run_id, workflow_id, actor, outcome, error_text, step_id, failure_kind FROM secret_access ORDER BY id ASC`)
	if err != nil {
		return nil, fmt.Errorf("secretauditstore: migrate: select: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var out []secretaudit.Record
	for rows.Next() {
		var r secretaudit.Record
		var ts, ctxVal, outcome, failureKind string
		if err := rows.Scan(&r.ID, &ts, &r.EntryID, &r.Label, &ctxVal, &r.RunID, &r.WorkflowID, &r.Actor, &outcome, &r.ErrorText, &r.StepID, &failureKind); err != nil {
			return nil, fmt.Errorf("secretauditstore: migrate: scan: %w", err)
		}
		r.Context = secretaudit.Context(ctxVal)
		r.Outcome = secretaudit.Outcome(outcome)
		r.FailureKind = secretaudit.FailureKind(failureKind)
		if parsed, err := time.Parse(legacyTimestampLayout, ts); err == nil {
			r.Timestamp = parsed
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("secretauditstore: migrate: rows: %w", err)
	}
	return out, nil
}

// ensureLegacySchema is this package's pre-goal-0351 widen-in-place
// logic, kept ONLY so a secret_access table created before actor/
// step_id/failure_kind existed still migrates correctly -- creating the
// table itself is a no-op here (migrateLegacyTable already confirmed it
// exists), so only the ALTER TABLE widening ever fires.
func ensureLegacySchema(db *sql.DB) error {
	if err := ensureLegacyColumn(db, "actor", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err := ensureLegacyColumn(db, "step_id", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err := ensureLegacyColumn(db, "failure_kind", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	return nil
}

// ensureLegacyColumn adds a column to secret_access when a pre-existing
// store predates it -- SQLite's one supported ALTER, guarded by the
// table's own column listing so a fresh schema is never altered twice.
func ensureLegacyColumn(db *sql.DB, name, decl string) error {
	rows, err := db.QueryContext(context.Background(), "PRAGMA table_info(secret_access)")
	if err != nil {
		return fmt.Errorf("secretauditstore: migrate: table_info: %w", err)
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var cid int
		var colName, colType string
		var notNull, pk int
		var dflt sql.NullString
		if err := rows.Scan(&cid, &colName, &colType, &notNull, &dflt, &pk); err != nil {
			return fmt.Errorf("secretauditstore: migrate: table_info scan: %w", err)
		}
		if colName == name {
			return nil
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("secretauditstore: migrate: table_info: %w", err)
	}
	if _, err := db.ExecContext(context.Background(), "ALTER TABLE secret_access ADD COLUMN "+name+" "+decl); err != nil {
		return fmt.Errorf("secretauditstore: migrate: add column %s: %w", name, err)
	}
	return nil
}
