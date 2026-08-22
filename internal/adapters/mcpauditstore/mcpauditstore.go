// Package mcpauditstore is the SQL storage adapter for Mill's MCP call
// audit trail (goal 0159 slice 1): a table in the SAME execution SQLite
// file DBOS already owns, reached through its own independent *sql.DB
// connection -- the adopted pattern internal/adapters/backup already
// established for touching that file outside DBOS's own transaction
// machinery (VACUUM INTO, PRAGMA integrity_check), not a new one
// invented here. Domain types live in internal/adapters/mcpaudit
// (.claude/rules/backend.md's storage-lives-one-layer-up rule); this
// package never imports a Wails-bound service.
package mcpauditstore

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/alicoding/mill/internal/adapters/mcpaudit"
	_ "modernc.org/sqlite" // registers the "sqlite" database/sql driver name
)

// busyTimeoutMS bounds how long a write here retries against a
// SQLITE_BUSY from DBOS's own concurrent writer holding the file's one
// write lock -- same value and reasoning as backup.go's own
// vacuumIntoBusyTimeout.
const busyTimeoutMS = 5000

// timestampLayout is RFC3339Nano in UTC -- lexicographically sortable
// (List's own ORDER BY relies on this), so newest-first and any future
// time-range filter never need to parse the column back out of text.
const timestampLayout = time.RFC3339Nano

// Store is one open connection to the execution SQLite file's mcp_calls
// table.
type Store struct {
	db *sql.DB
}

// Open opens dbPath (a plain sqlite file path, never a "sqlite:"-
// prefixed DSN -- same caller-strips-the-scheme convention
// internal/adapters/execution documents) as its own independent
// connection and ensures the mcp_calls table/indexes exist.
func Open(dbPath string) (*Store, error) {
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("mcpauditstore: open: %w", err)
	}
	if _, err := db.ExecContext(context.Background(), fmt.Sprintf("PRAGMA busy_timeout = %d", busyTimeoutMS)); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("mcpauditstore: set busy_timeout: %w", err)
	}
	if err := ensureSchema(db); err != nil {
		_ = db.Close()
		return nil, err
	}
	return &Store{db: db}, nil
}

func ensureSchema(db *sql.DB) error {
	const schema = `
CREATE TABLE IF NOT EXISTS mcp_calls (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	timestamp TEXT NOT NULL,
	direction TEXT NOT NULL,
	session_id TEXT NOT NULL DEFAULT '',
	method_name TEXT NOT NULL,
	tool_name TEXT NOT NULL DEFAULT '',
	caller_identity TEXT NOT NULL DEFAULT '',
	outcome TEXT NOT NULL,
	duration_ms INTEGER NOT NULL DEFAULT 0,
	error_text TEXT NOT NULL DEFAULT '',
	arg_bytes INTEGER NOT NULL DEFAULT 0,
	parked_write_id TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_mcp_calls_timestamp ON mcp_calls(timestamp);
CREATE INDEX IF NOT EXISTS idx_mcp_calls_direction ON mcp_calls(direction);
CREATE INDEX IF NOT EXISTS idx_mcp_calls_tool_name ON mcp_calls(tool_name);
CREATE INDEX IF NOT EXISTS idx_mcp_calls_parked_write_id ON mcp_calls(parked_write_id);
`
	if _, err := db.ExecContext(context.Background(), schema); err != nil {
		return fmt.Errorf("mcpauditstore: ensure schema: %w", err)
	}
	return nil
}

// Close closes the underlying connection.
func (s *Store) Close() error {
	return s.db.Close()
}

// Insert records r and returns its new row id. Timestamp defaults to
// time.Now().UTC() when the caller left it zero. Takes ctx (rather than
// context.Background() internally, like this file's other methods) so
// the audit middleware's own request ctx propagates through -- both
// middlewares already have one in scope for every call they record.
func (s *Store) Insert(ctx context.Context, r mcpaudit.Record) (int64, error) {
	ts := r.Timestamp
	if ts.IsZero() {
		ts = time.Now().UTC()
	}
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO mcp_calls (timestamp, direction, session_id, method_name, tool_name, caller_identity, outcome, duration_ms, error_text, arg_bytes, parked_write_id)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		ts.Format(timestampLayout), string(r.Direction), r.SessionID, r.MethodName, r.ToolName, r.CallerIdentity,
		string(r.Outcome), r.DurationMS, mcpaudit.TruncateError(r.ErrorText), r.ArgBytes, r.ParkedWriteID,
	)
	if err != nil {
		return 0, fmt.Errorf("mcpauditstore: insert: %w", err)
	}
	return res.LastInsertId()
}

// UpdateOutcome mutates the most recent still-OutcomeParked row whose
// parked_write_id is writeID to outcome/errorText -- called once a
// parked write resolves (approved/denied/expired/cancelled), well after
// the original Insert's request/response round trip already returned.
// A no-op (nil error, zero rows affected) when no matching parked row
// exists -- audit is best-effort observability, never allowed to fail
// the real resolution it's describing.
func (s *Store) UpdateOutcome(writeID string, outcome mcpaudit.Outcome, errorText string) error {
	if writeID == "" {
		return nil
	}
	_, err := s.db.ExecContext(context.Background(),
		`UPDATE mcp_calls SET outcome = ?, error_text = ?
		 WHERE id = (SELECT id FROM mcp_calls WHERE parked_write_id = ? AND outcome = ? ORDER BY id DESC LIMIT 1)`,
		string(outcome), mcpaudit.TruncateError(errorText), writeID, string(mcpaudit.OutcomeParked),
	)
	if err != nil {
		return fmt.Errorf("mcpauditstore: update outcome for parked write %q: %w", writeID, err)
	}
	return nil
}

// Prune deletes every row past the newest keep rows (by id, which is
// monotonically increasing with insertion order). keep <= 0 is a no-op,
// same "never silently unbounded" guard backup.go's own prune uses.
// Returns the number of rows deleted.
func (s *Store) Prune(keep int) (int64, error) {
	if keep <= 0 {
		return 0, nil
	}
	res, err := s.db.ExecContext(context.Background(),
		`DELETE FROM mcp_calls WHERE id NOT IN (SELECT id FROM mcp_calls ORDER BY id DESC LIMIT ?)`, keep,
	)
	if err != nil {
		return 0, fmt.Errorf("mcpauditstore: prune: %w", err)
	}
	return res.RowsAffected()
}
