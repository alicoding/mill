// Package mcpauditstore is the storage adapter for Mill's MCP call
// audit trail (goal 0159 slice 1). Its own public Store/Open/Insert/
// List/Prune/UpdateOutcome API is UNCHANGED since goal 0351: every row
// now lives in the shared internal/adapters/auditstore's audit_entries
// table (kind="mcp-call"), reached through this Store's own
// independent *sql.DB connection to the SAME execution SQLite file
// (mirrors internal/adapters/backup's own pattern, same as before).
// mcp_calls, this package's original table, is migrated into
// audit_entries ONCE the first time Open sees it still present, then
// dropped (migrate.go) -- callers of this package never see the
// difference. Domain types live in internal/adapters/mcpaudit; this
// package never imports a Wails-bound service.
package mcpauditstore

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/alicoding/mill/internal/adapters/auditstore"
	"github.com/alicoding/mill/internal/adapters/mcpaudit"
	"github.com/alicoding/mill/internal/domain/audit"
	_ "modernc.org/sqlite" // registers the "sqlite" database/sql driver name
)

// busyTimeoutMS bounds how long a write here retries against a
// SQLITE_BUSY from DBOS's own concurrent writer holding the file's one
// write lock -- same value and reasoning as backup.go's own
// vacuumIntoBusyTimeout.
const busyTimeoutMS = 5000

// timestampLayout is RFC3339Nano in UTC -- mirrors legacyRow's own
// parsing needs during migration (the shared store's own rows are
// timestamped this package never touches directly any more).
const timestampLayout = time.RFC3339Nano

// Store is one open connection to the execution SQLite file, reading
// and writing mcp-call rows in the shared audit_entries table.
type Store struct {
	db *sql.DB
}

// Open opens dbPath (a plain sqlite file path, never a "sqlite:"-
// prefixed DSN) as its own independent connection, ensures the shared
// audit_entries table exists, and migrates any pre-goal-0351 mcp_calls
// table into it (migrate.go) -- a no-op once that migration has already
// run.
func Open(dbPath string) (*Store, error) {
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("mcpauditstore: open: %w", err)
	}
	if _, err := db.ExecContext(context.Background(), fmt.Sprintf("PRAGMA busy_timeout = %d", busyTimeoutMS)); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("mcpauditstore: set busy_timeout: %w", err)
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
func (s *Store) Insert(ctx context.Context, r mcpaudit.Record) (int64, error) {
	return auditstore.InsertEntry(ctx, s.db, toEntry(r))
}

// UpdateOutcome mutates the most recent still-OutcomeParked row whose
// parked_write_id is writeID to outcome/errorText -- called once a
// parked write resolves. A no-op (nil error, zero rows affected) when
// no matching parked row exists -- audit is best-effort observability,
// never allowed to fail the real resolution it's describing.
// parked_write_id lives inside the shared row's Attributes (never a
// dedicated column), so the matching row is found by scanning parked
// mcp-call rows newest-first in Go, then updated by id -- the same
// "most recent match wins" contract the old dedicated column supported.
func (s *Store) UpdateOutcome(writeID string, outcome mcpaudit.Outcome, errorText string) error {
	if writeID == "" {
		return nil
	}
	ctx := context.Background()
	// Runs inside one transaction -- SQLite serializes writers on the
	// reserved lock a write transaction takes, so a second concurrent
	// UpdateOutcome for the same writeID can't interleave its own
	// find-then-update between this one's SELECT and UPDATE. The final
	// UPDATE's own "outcome = parked" guard (updateOutcomeRow) is a
	// second, independent safeguard against the same race.
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("mcpauditstore: update outcome for parked write %q: begin: %w", writeID, err)
	}
	matchID, err := findParkedRowID(ctx, tx, writeID)
	if err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("mcpauditstore: update outcome for parked write %q: %w", writeID, err)
	}
	if matchID == 0 {
		return tx.Rollback()
	}
	if err := updateOutcomeRow(ctx, tx, matchID, outcome, errorText); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("mcpauditstore: update outcome for parked write %q: %w", writeID, err)
	}
	return tx.Commit()
}

// querier is satisfied by both *sql.DB and *sql.Tx -- UpdateOutcome
// runs its find-then-update on one *sql.Tx so both steps see a
// consistent snapshot; the migration path (migrate.go) never calls
// these, so no Execer-style dual-use is needed here.
type querier interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

// findParkedRowID returns the most recent still-parked mcp-call row's id
// whose Attributes["parked_write_id"] is writeID, or 0 when none match.
func findParkedRowID(ctx context.Context, db querier, writeID string) (int64, error) {
	//nolint:gosec // G202: EntryColumns/TableName are this package's own compile-time constants, never caller input; the only caller-supplied values (kind, outcome) are bound as placeholders below.
	q := "SELECT " + auditstore.EntryColumns + " FROM " + auditstore.TableName + " WHERE kind = ? AND outcome = ? ORDER BY id DESC"
	rows, err := db.QueryContext(ctx, q, string(audit.KindMCPCall), string(mcpaudit.OutcomeParked))
	if err != nil {
		return 0, err
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		e, scanErr := auditstore.ScanEntry(rows)
		if scanErr != nil {
			return 0, scanErr
		}
		if e.Attributes["parked_write_id"] == writeID {
			return e.ID, nil
		}
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}
	return 0, nil
}

// updateOutcomeRow rewrites row id's outcome and its attributes'
// error_text via a read-modify-write on the JSON blob -- Go-side rather
// than a SQL JSON1 function, so this never depends on the build's
// SQLite carrying that extension. The UPDATE's own "AND outcome = ?
// (parked)" guard mirrors the pre-goal-0351 single-statement UPDATE's
// atomicity: a row already resolved by a concurrent call is left alone
// rather than clobbered, even if this ever runs outside UpdateOutcome's
// own transaction wrapper.
func updateOutcomeRow(ctx context.Context, db querier, id int64, outcome mcpaudit.Outcome, errorText string) error {
	var attrsJSON string
	if err := db.QueryRowContext(ctx, "SELECT attributes FROM "+auditstore.TableName+" WHERE id = ?", id).Scan(&attrsJSON); err != nil {
		return fmt.Errorf("mcpauditstore: update outcome: read: %w", err)
	}
	attrs := map[string]string{}
	if attrsJSON != "" {
		_ = json.Unmarshal([]byte(attrsJSON), &attrs)
	}
	attrs["error_text"] = mcpaudit.TruncateError(errorText)
	encoded, err := json.Marshal(attrs)
	if err != nil {
		return fmt.Errorf("mcpauditstore: update outcome: marshal: %w", err)
	}
	//nolint:gosec // G202: auditstore.TableName is this package's own compile-time constant, never caller input; the only caller-supplied values (outcome, encoded, id) are bound as placeholders below.
	q := "UPDATE " + auditstore.TableName + " SET outcome = ?, attributes = ? WHERE id = ? AND outcome = ?"
	if _, err := db.ExecContext(ctx, q, string(outcome), string(encoded), id, string(mcpaudit.OutcomeParked)); err != nil {
		return fmt.Errorf("mcpauditstore: update outcome: write: %w", err)
	}
	return nil
}

// Prune deletes every row past the newest keep rows of THIS package's
// own kind (mcp-call) -- unlike the shared auditstore.Store.Prune,
// which spans every kind (goal 0351 Decision 4's cap is applied there,
// not here). keep <= 0 is a no-op. Returns the number of rows deleted.
func (s *Store) Prune(keep int) (int64, error) {
	if keep <= 0 {
		return 0, nil
	}
	//nolint:gosec // G202: auditstore.TableName is this package's own compile-time constant, never caller input; the only caller-supplied values (kind, keep) are bound as placeholders below.
	q := "DELETE FROM " + auditstore.TableName + " WHERE kind = ? AND id NOT IN (SELECT id FROM " + auditstore.TableName + " WHERE kind = ? ORDER BY id DESC LIMIT ?)"
	res, err := s.db.ExecContext(context.Background(), q,
		string(audit.KindMCPCall), string(audit.KindMCPCall), keep,
	)
	if err != nil {
		return 0, fmt.Errorf("mcpauditstore: prune: %w", err)
	}
	return res.RowsAffected()
}

// toEntry maps one mcpaudit.Record onto the shared envelope.
// CallerIdentity's own documented rule (mcpaudit/context.go's
// WithCallerIdentity doc comment) decides where it lands: server side
// it's the connecting client's own identity (an external actor, never
// Mill's own run/step), so it becomes Actor.Source; client side it's
// either "agentloop-<sessionID>" (the agent loop) or a workflow step id
// (mcp-tool-call node calls), so it splits into AgentSession or StepID.
func toEntry(r mcpaudit.Record) audit.Entry {
	e := audit.Entry{
		ID: r.ID, Timestamp: r.Timestamp, Kind: audit.KindMCPCall,
		Action: r.MethodName, Outcome: string(r.Outcome),
		Attributes: map[string]string{"direction": string(r.Direction)},
	}
	switch r.Direction {
	case mcpaudit.DirectionServer:
		e.Actor.Source = r.CallerIdentity
	case mcpaudit.DirectionClient:
		if sessionID, ok := strings.CutPrefix(r.CallerIdentity, "agentloop-"); ok {
			e.Actor.AgentSession = sessionID
		} else {
			e.Actor.StepID = r.CallerIdentity
		}
	}
	if r.ToolName != "" {
		e.Target = audit.Target{Kind: "tool", ID: r.ToolName}
	}
	if r.SessionID != "" {
		e.Attributes["session_id"] = r.SessionID
	}
	if r.DurationMS != 0 {
		e.Attributes["duration_ms"] = strconv.FormatInt(r.DurationMS, 10)
	}
	if r.ArgBytes != 0 {
		e.Attributes["arg_bytes"] = strconv.FormatInt(r.ArgBytes, 10)
	}
	if r.ErrorText != "" {
		e.Attributes["error_text"] = mcpaudit.TruncateError(r.ErrorText)
	}
	if r.ParkedWriteID != "" {
		e.Attributes["parked_write_id"] = r.ParkedWriteID
	}
	return e
}

// fromEntry is toEntry's inverse -- CallerIdentity is rebuilt from
// whichever Actor field toEntry populated.
func fromEntry(e audit.Entry) mcpaudit.Record {
	r := mcpaudit.Record{
		ID: e.ID, Timestamp: e.Timestamp, MethodName: e.Action, Outcome: mcpaudit.Outcome(e.Outcome),
		Direction: mcpaudit.Direction(e.Attributes["direction"]),
		SessionID: e.Attributes["session_id"], ErrorText: e.Attributes["error_text"],
		ParkedWriteID: e.Attributes["parked_write_id"],
	}
	if e.Target.Kind == "tool" {
		r.ToolName = e.Target.ID
	}
	if v, ok := e.Attributes["duration_ms"]; ok {
		r.DurationMS, _ = strconv.ParseInt(v, 10, 64)
	}
	if v, ok := e.Attributes["arg_bytes"]; ok {
		r.ArgBytes, _ = strconv.ParseInt(v, 10, 64)
	}
	switch {
	case e.Actor.AgentSession != "":
		r.CallerIdentity = "agentloop-" + e.Actor.AgentSession
	case e.Actor.StepID != "":
		r.CallerIdentity = e.Actor.StepID
	case e.Actor.Source != "":
		r.CallerIdentity = e.Actor.Source
	}
	return r
}
