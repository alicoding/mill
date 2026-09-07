// Package secretauditstore is the storage adapter for Mill's secret
// read audit trail (goal 0203 S3). Its own public Store/Open/Insert/
// List/Prune API is UNCHANGED since goal 0351: every row now lives in
// the shared internal/adapters/auditstore's audit_entries table
// (kind="secret-access"), reached through this Store's own independent
// *sql.DB connection to the SAME execution SQLite file mcpauditstore
// also connects to. secret_access, this package's original table
// (including any pre-goal-0351 widened columns: actor, step_id,
// failure_kind), is migrated into audit_entries ONCE the first time
// Open sees it still present, then dropped (migrate.go) -- callers of
// this package never see the difference. Domain types live in
// internal/adapters/secretaudit; this package never imports a
// Wails-bound service.
package secretauditstore

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/alicoding/mill/internal/adapters/auditstore"
	"github.com/alicoding/mill/internal/adapters/secretaudit"
	"github.com/alicoding/mill/internal/domain/audit"
	_ "modernc.org/sqlite" // registers the "sqlite" database/sql driver name
)

// busyTimeoutMS mirrors mcpauditstore's own value/reasoning: bounds how
// long a write here retries against a SQLITE_BUSY from DBOS's own
// concurrent writer holding the file's one write lock.
const busyTimeoutMS = 5000

// Store is one open connection to the execution SQLite file, reading
// and writing secret-access rows in the shared audit_entries table.
type Store struct {
	db *sql.DB
}

// Open opens dbPath (a plain sqlite file path, never a "sqlite:"-
// prefixed DSN) as its own independent connection, ensures the shared
// audit_entries table exists, and migrates any pre-goal-0351
// secret_access table into it (migrate.go) -- a no-op once that
// migration has already run.
func Open(dbPath string) (*Store, error) {
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("secretauditstore: open: %w", err)
	}
	if _, err := db.ExecContext(context.Background(), fmt.Sprintf("PRAGMA busy_timeout = %d", busyTimeoutMS)); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("secretauditstore: set busy_timeout: %w", err)
	}
	if _, err := auditstore.New(db); err != nil {
		_ = db.Close()
		return nil, err
	}
	if err := migrateLegacyTable(db); err != nil {
		_ = db.Close()
		return nil, err
	}
	return &Store{db: db}, nil
}

// Close closes the underlying connection.
func (s *Store) Close() error {
	return s.db.Close()
}

// Insert records r and returns its new row id. Timestamp defaults to
// time.Now().UTC() when the caller left it zero.
func (s *Store) Insert(ctx context.Context, r secretaudit.Record) (int64, error) {
	return auditstore.InsertEntry(ctx, s.db, toEntry(r))
}

// Prune deletes every row past the newest keep rows of THIS package's
// own kind (secret-access) -- unlike the shared auditstore.Store.Prune,
// which spans every kind (goal 0351 Decision 4's cap is applied there,
// not here). keep <= 0 is a no-op. Returns the number of rows deleted.
func (s *Store) Prune(keep int) (int64, error) {
	if keep <= 0 {
		return 0, nil
	}
	//nolint:gosec // G202: auditstore.TableName is this package's own compile-time constant, never caller input; the only caller-supplied values (kind, keep) are bound as placeholders below.
	q := "DELETE FROM " + auditstore.TableName + " WHERE kind = ? AND id NOT IN (SELECT id FROM " + auditstore.TableName + " WHERE kind = ? ORDER BY id DESC LIMIT ?)"
	res, err := s.db.ExecContext(context.Background(), q,
		string(audit.KindSecretAccess), string(audit.KindSecretAccess), keep,
	)
	if err != nil {
		return 0, fmt.Errorf("secretauditstore: prune: %w", err)
	}
	return res.RowsAffected()
}

// toEntry maps one secretaudit.Record onto the shared envelope --
// Context becomes Action, EntryID/Label become Target, Actor's own
// string (a non-workflow reader like "plugin:<id>") becomes
// Actor.Source (goal 0351 PR1 item 3's own mapping).
func toEntry(r secretaudit.Record) audit.Entry {
	e := audit.Entry{
		ID: r.ID, Timestamp: r.Timestamp, Kind: audit.KindSecretAccess,
		Action: string(r.Context), Outcome: string(r.Outcome), FailureKind: string(r.FailureKind),
		Target:     audit.Target{Kind: "secret", ID: r.EntryID, Label: r.Label},
		Attributes: map[string]string{},
	}
	e.Actor = audit.Actor{RunID: r.RunID, WorkflowID: r.WorkflowID, StepID: r.StepID, Source: r.Actor}
	if r.ErrorText != "" {
		e.Attributes["error_text"] = secretaudit.TruncateError(r.ErrorText)
	}
	return e
}

// fromEntry is toEntry's inverse.
func fromEntry(e audit.Entry) secretaudit.Record {
	return secretaudit.Record{
		ID: e.ID, Timestamp: e.Timestamp, EntryID: e.Target.ID, Label: e.Target.Label,
		Context: secretaudit.Context(e.Action), RunID: e.Actor.RunID, WorkflowID: e.Actor.WorkflowID,
		StepID: e.Actor.StepID, Actor: e.Actor.Source, Outcome: secretaudit.Outcome(e.Outcome),
		FailureKind: secretaudit.FailureKind(e.FailureKind), ErrorText: e.Attributes["error_text"],
	}
}
