package mcpauditstore

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/alicoding/mill/internal/adapters/auditstore"
	"github.com/alicoding/mill/internal/adapters/mcpaudit"
)

// migrateLegacyTable copies every row of the pre-goal-0351 mcp_calls
// table into the shared audit_entries table, then drops mcp_calls --
// goal 0351 Decision 2's one-time migration. Idempotent: a no-op the
// moment mcp_calls no longer exists, so calling Open (and therefore
// this) twice on the same file only ever migrates once, with no
// separate schema-version counter needed. Runs inside one transaction
// so a crash mid-migration never leaves duplicated rows on the next
// Open (mcp_calls survives untouched until the copy AND the drop both
// commit).
func migrateLegacyTable(db *sql.DB) error {
	exists, err := auditstore.TableExists(db, "mcp_calls")
	if err != nil {
		return err
	}
	if !exists {
		return nil
	}

	ctx := context.Background()
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("mcpauditstore: migrate: begin: %w", err)
	}
	legacyRows, err := readLegacyRows(ctx, tx)
	if err != nil {
		_ = tx.Rollback()
		return err
	}
	for _, r := range legacyRows {
		if _, err := auditstore.InsertEntry(ctx, tx, toEntry(r)); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("mcpauditstore: migrate: insert: %w", err)
		}
	}
	if _, err := tx.ExecContext(ctx, "DROP TABLE mcp_calls"); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("mcpauditstore: migrate: drop: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("mcpauditstore: migrate: commit: %w", err)
	}
	return nil
}

// readLegacyRows selects every mcp_calls row, oldest first, so the
// migrated rows land in audit_entries in their original relative order.
func readLegacyRows(ctx context.Context, tx *sql.Tx) ([]mcpaudit.Record, error) {
	rows, err := tx.QueryContext(ctx, `SELECT id, timestamp, direction, session_id, method_name, tool_name, caller_identity, outcome, duration_ms, error_text, arg_bytes, parked_write_id FROM mcp_calls ORDER BY id ASC`)
	if err != nil {
		return nil, fmt.Errorf("mcpauditstore: migrate: select: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var out []mcpaudit.Record
	for rows.Next() {
		var r mcpaudit.Record
		var ts, direction, outcome string
		if err := rows.Scan(&r.ID, &ts, &direction, &r.SessionID, &r.MethodName, &r.ToolName, &r.CallerIdentity,
			&outcome, &r.DurationMS, &r.ErrorText, &r.ArgBytes, &r.ParkedWriteID); err != nil {
			return nil, fmt.Errorf("mcpauditstore: migrate: scan: %w", err)
		}
		r.Direction = mcpaudit.Direction(direction)
		r.Outcome = mcpaudit.Outcome(outcome)
		if parsed, err := time.Parse(timestampLayout, ts); err == nil {
			r.Timestamp = parsed
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("mcpauditstore: migrate: rows: %w", err)
	}
	return out, nil
}
