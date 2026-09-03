// Package secretauditstore is the SQL storage adapter for Mill's secret
// read audit trail (goal 0203 S3): a table in the SAME execution SQLite
// file DBOS/mcpauditstore already own, reached through its own
// independent *sql.DB connection -- mcpauditstore.Open's own doc
// comment names the adopted pattern (internal/adapters/backup
// established it first); this package mirrors mcpauditstore's shape
// deliberately but owns its OWN table, never mcpaudit's (a secret read
// is not an MCP call). Domain types live in internal/adapters/
// secretaudit (.claude/rules/backend.md's storage-lives-one-layer-up
// rule); this package never imports a Wails-bound service.
package secretauditstore

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/alicoding/mill/internal/adapters/secretaudit"
	_ "modernc.org/sqlite" // registers the "sqlite" database/sql driver name
)

// busyTimeoutMS mirrors mcpauditstore's own value/reasoning: bounds how
// long a write here retries against a SQLITE_BUSY from DBOS's own
// concurrent writer holding the file's one write lock.
const busyTimeoutMS = 5000

// timestampLayout is RFC3339Nano in UTC -- lexicographically sortable,
// same reasoning as mcpauditstore's own constant.
const timestampLayout = time.RFC3339Nano

// Store is one open connection to the execution SQLite file's
// secret_access table.
type Store struct {
	db *sql.DB
}

// Open opens dbPath (a plain sqlite file path, never a "sqlite:"-
// prefixed DSN) as its own independent connection and ensures the
// secret_access table/indexes exist.
func Open(dbPath string) (*Store, error) {
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("secretauditstore: open: %w", err)
	}
	if _, err := db.ExecContext(context.Background(), fmt.Sprintf("PRAGMA busy_timeout = %d", busyTimeoutMS)); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("secretauditstore: set busy_timeout: %w", err)
	}
	if err := ensureSchema(db); err != nil {
		_ = db.Close()
		return nil, err
	}
	return &Store{db: db}, nil
}

func ensureSchema(db *sql.DB) error {
	const schema = `
CREATE TABLE IF NOT EXISTS secret_access (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	timestamp TEXT NOT NULL,
	entry_id TEXT NOT NULL,
	label TEXT NOT NULL DEFAULT '',
	context TEXT NOT NULL,
	run_id TEXT NOT NULL DEFAULT '',
	workflow_id TEXT NOT NULL DEFAULT '',
	actor TEXT NOT NULL DEFAULT '',
	outcome TEXT NOT NULL,
	error_text TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_secret_access_timestamp ON secret_access(timestamp);
CREATE INDEX IF NOT EXISTS idx_secret_access_entry_id ON secret_access(entry_id);
CREATE INDEX IF NOT EXISTS idx_secret_access_context ON secret_access(context);
`
	if _, err := db.ExecContext(context.Background(), schema); err != nil {
		return fmt.Errorf("secretauditstore: ensure schema: %w", err)
	}
	// actor arrived with ADR-0048 (plugin readers); a store created
	// before it lacks the column and is widened in place.
	if err := ensureColumn(db, "actor", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	return nil
}

// ensureColumn adds a column to secret_access when a pre-existing
// store predates it -- SQLite's one supported ALTER, guarded by the
// table's own column listing so a fresh schema is never altered twice.
func ensureColumn(db *sql.DB, name, decl string) error {
	rows, err := db.QueryContext(context.Background(), "PRAGMA table_info(secret_access)")
	if err != nil {
		return fmt.Errorf("secretauditstore: table_info: %w", err)
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var cid int
		var colName, colType string
		var notNull, pk int
		var dflt sql.NullString
		if err := rows.Scan(&cid, &colName, &colType, &notNull, &dflt, &pk); err != nil {
			return fmt.Errorf("secretauditstore: table_info scan: %w", err)
		}
		if colName == name {
			return nil
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("secretauditstore: table_info: %w", err)
	}
	if _, err := db.ExecContext(context.Background(), "ALTER TABLE secret_access ADD COLUMN "+name+" "+decl); err != nil {
		return fmt.Errorf("secretauditstore: add column %s: %w", name, err)
	}
	return nil
}

// Close closes the underlying connection.
func (s *Store) Close() error {
	return s.db.Close()
}

// Insert records r and returns its new row id. Timestamp defaults to
// time.Now().UTC() when the caller left it zero.
func (s *Store) Insert(ctx context.Context, r secretaudit.Record) (int64, error) {
	ts := r.Timestamp
	if ts.IsZero() {
		ts = time.Now().UTC()
	}
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO secret_access (timestamp, entry_id, label, context, run_id, workflow_id, actor, outcome, error_text)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		ts.Format(timestampLayout), r.EntryID, r.Label, string(r.Context), r.RunID, r.WorkflowID, r.Actor,
		string(r.Outcome), secretaudit.TruncateError(r.ErrorText),
	)
	if err != nil {
		return 0, fmt.Errorf("secretauditstore: insert: %w", err)
	}
	return res.LastInsertId()
}

// Prune deletes every row past the newest keep rows (by id). keep <= 0
// is a no-op, mirroring mcpauditstore.Prune's own guard. Returns the
// number of rows deleted.
func (s *Store) Prune(keep int) (int64, error) {
	if keep <= 0 {
		return 0, nil
	}
	res, err := s.db.ExecContext(context.Background(),
		`DELETE FROM secret_access WHERE id NOT IN (SELECT id FROM secret_access ORDER BY id DESC LIMIT ?)`, keep,
	)
	if err != nil {
		return 0, fmt.Errorf("secretauditstore: prune: %w", err)
	}
	return res.RowsAffected()
}
