// Package auditstore is the SQL storage adapter for Mill's shared audit
// trail (goal 0351): ONE table, audit_entries, holding every producer's
// rows discriminated by kind -- the same SQLite adapter pattern
// mcpauditstore/secretauditstore already established (a table in the
// same execution SQLite file DBOS owns, reached through an independent
// connection), reused rather than a new one invented here. Domain type
// lives in internal/domain/audit; this package never imports a
// Wails-bound service. mcpauditstore and secretauditstore keep their
// OWN sql.DB connections to the same file and call the exported
// helpers below (EnsureSchema, InsertEntry, ScanEntry, TableExists)
// directly rather than going through Store, since their own Filter
// shapes (Direction, ActorPrefix, ...) don't map onto this package's
// Filter one-for-one -- Store's own List/Prune/Append are for a NEW
// caller reading/writing every kind at once (goal 0351 PR2's auditsvc
// and the browser bridge).
package auditstore

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/alicoding/mill/internal/domain/audit"
	_ "modernc.org/sqlite" // registers the "sqlite" database/sql driver name
)

// busyTimeoutMS mirrors mcpauditstore/secretauditstore's own value and
// reasoning: bounds how long a write here retries against a
// SQLITE_BUSY from DBOS's own concurrent writer holding the file's one
// write lock.
const busyTimeoutMS = 5000

// timestampLayout is RFC3339Nano in UTC -- lexicographically sortable,
// same reasoning as mcpauditstore/secretauditstore's own constant.
const timestampLayout = time.RFC3339Nano

// TableName is audit_entries' name, exported so a sibling adapter
// package can reference it in its own migration/DROP TABLE statements
// without retyping the literal.
const TableName = "audit_entries"

// EntryColumns is the canonical SELECT/Scan column order every reader
// (this package's own List and every sibling adapter's own kind-scoped
// query) uses -- one source of truth so a column can never drift
// between a SELECT list and a Scan call.
const EntryColumns = "id, timestamp, kind, run_id, workflow_id, step_id, agent_session, source, action, target_kind, target_id, target_label, outcome, failure_kind, attributes"

// Store is one open connection to the execution SQLite file's
// audit_entries table.
type Store struct {
	db   *sql.DB
	owns bool
}

// Open opens dbPath (a plain sqlite file path, never a "sqlite:"-
// prefixed DSN) as its own independent connection and ensures the
// audit_entries table/indexes exist. The returned Store owns db: Close
// closes it.
func Open(dbPath string) (*Store, error) {
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("auditstore: open: %w", err)
	}
	if _, err := db.ExecContext(context.Background(), fmt.Sprintf("PRAGMA busy_timeout = %d", busyTimeoutMS)); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("auditstore: set busy_timeout: %w", err)
	}
	if err := EnsureSchema(db); err != nil {
		_ = db.Close()
		return nil, err
	}
	return &Store{db: db, owns: true}, nil
}

// New wraps an already-open connection to the same execution SQLite
// file a sibling adapter (mcpauditstore, secretauditstore) already
// owns -- ensures audit_entries exists on it but never closes db: the
// caller's own Close stays the one owner of that connection.
func New(db *sql.DB) (*Store, error) {
	if err := EnsureSchema(db); err != nil {
		return nil, err
	}
	return &Store{db: db, owns: false}, nil
}

// EnsureSchema creates audit_entries and its indexes on db if they
// don't already exist -- exported so a sibling adapter package that
// opens its own connection to the same file can ensure the shared
// table exists without importing sql.Open logic of its own.
func EnsureSchema(db *sql.DB) error {
	const schema = `
CREATE TABLE IF NOT EXISTS audit_entries (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	timestamp TEXT NOT NULL,
	kind TEXT NOT NULL,
	run_id TEXT NOT NULL DEFAULT '',
	workflow_id TEXT NOT NULL DEFAULT '',
	step_id TEXT NOT NULL DEFAULT '',
	agent_session TEXT NOT NULL DEFAULT '',
	source TEXT NOT NULL DEFAULT '',
	action TEXT NOT NULL DEFAULT '',
	target_kind TEXT NOT NULL DEFAULT '',
	target_id TEXT NOT NULL DEFAULT '',
	target_label TEXT NOT NULL DEFAULT '',
	outcome TEXT NOT NULL DEFAULT '',
	failure_kind TEXT NOT NULL DEFAULT '',
	attributes TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_audit_entries_kind_timestamp ON audit_entries(kind, timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_entries_run_id ON audit_entries(run_id);
`
	if _, err := db.ExecContext(context.Background(), schema); err != nil {
		return fmt.Errorf("auditstore: ensure schema: %w", err)
	}
	return nil
}

// TableExists reports whether a table named name exists in db --
// exported for a sibling adapter's own once-at-startup legacy-table
// migration (goal 0351 Decision 2): migration is a no-op exactly when
// the legacy table no longer exists, making Open idempotent across
// repeated calls with no separate schema-version counter needed.
func TableExists(db *sql.DB, name string) (bool, error) {
	var found string
	err := db.QueryRowContext(context.Background(),
		"SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", name,
	).Scan(&found)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("auditstore: table_exists(%s): %w", name, err)
	}
	return true, nil
}

// Close closes the underlying connection when this Store opened it
// itself (Open); a Store built via New leaves the caller's connection
// open.
func (s *Store) Close() error {
	if !s.owns {
		return nil
	}
	return s.db.Close()
}

// Execer is satisfied by both *sql.DB and *sql.Tx -- InsertEntry
// accepts either so a sibling adapter's own once-at-startup migration
// can batch its legacy rows inside one transaction.
type Execer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

// InsertEntry validates e's attributes against its Kind's allowlist
// (goal 0351 Decision 1) and writes one audit_entries row through ex,
// returning the new row id.
func InsertEntry(ctx context.Context, ex Execer, e audit.Entry) (int64, error) {
	if err := audit.ValidateAttributes(e.Kind, e.Attributes); err != nil {
		return 0, fmt.Errorf("auditstore: %w", err)
	}
	ts := e.Timestamp
	if ts.IsZero() {
		ts = time.Now().UTC()
	}
	attrs := e.Attributes
	if attrs == nil {
		attrs = map[string]string{}
	}
	attrsJSON, err := json.Marshal(attrs)
	if err != nil {
		return 0, fmt.Errorf("auditstore: marshal attributes: %w", err)
	}
	res, err := ex.ExecContext(ctx,
		`INSERT INTO audit_entries (timestamp, kind, run_id, workflow_id, step_id, agent_session, source, action, target_kind, target_id, target_label, outcome, failure_kind, attributes)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		ts.Format(timestampLayout), string(e.Kind), e.Actor.RunID, e.Actor.WorkflowID, e.Actor.StepID, e.Actor.AgentSession, e.Actor.Source,
		e.Action, e.Target.Kind, e.Target.ID, e.Target.Label, e.Outcome, e.FailureKind, string(attrsJSON),
	)
	if err != nil {
		return 0, fmt.Errorf("auditstore: insert: %w", err)
	}
	return res.LastInsertId()
}

// rowScanner is satisfied by both *sql.Row and *sql.Rows.
type rowScanner interface {
	Scan(dest ...any) error
}

// ScanEntry reads one row in EntryColumns' own order -- the caller's
// SELECT must list columns in exactly that order.
func ScanEntry(row rowScanner) (audit.Entry, error) {
	var e audit.Entry
	var ts, kind, attrsJSON string
	if err := row.Scan(&e.ID, &ts, &kind, &e.Actor.RunID, &e.Actor.WorkflowID, &e.Actor.StepID, &e.Actor.AgentSession, &e.Actor.Source,
		&e.Action, &e.Target.Kind, &e.Target.ID, &e.Target.Label, &e.Outcome, &e.FailureKind, &attrsJSON); err != nil {
		return audit.Entry{}, fmt.Errorf("auditstore: scan: %w", err)
	}
	e.Kind = audit.Kind(kind)
	if parsed, err := time.Parse(timestampLayout, ts); err == nil {
		e.Timestamp = parsed
	}
	if attrsJSON != "" {
		_ = json.Unmarshal([]byte(attrsJSON), &e.Attributes)
	}
	return e, nil
}

// Append validates and writes one Entry, returning its new row id.
func (s *Store) Append(ctx context.Context, e audit.Entry) (int64, error) {
	return InsertEntry(ctx, s.db, e)
}

// Prune deletes every row past the newest keep rows (by id) ACROSS
// EVERY kind -- goal 0351 Decision 4's one shared retention cap, unlike
// mcpauditstore/secretauditstore's own kind-scoped Prune. keep <= 0 is
// a no-op. Returns the number of rows deleted.
func (s *Store) Prune(ctx context.Context, keep int) (int64, error) {
	if keep <= 0 {
		return 0, nil
	}
	res, err := s.db.ExecContext(ctx,
		`DELETE FROM audit_entries WHERE id NOT IN (SELECT id FROM audit_entries ORDER BY id DESC LIMIT ?)`, keep,
	)
	if err != nil {
		return 0, fmt.Errorf("auditstore: prune: %w", err)
	}
	return res.RowsAffected()
}
