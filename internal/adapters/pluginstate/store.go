// Package pluginstate owns the durable SQLite state used by the extension
// source catalog. Domain validation stays in pluginsvc; this adapter only
// publishes and retrieves opaque payloads transactionally.
package pluginstate

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	_ "modernc.org/sqlite"
)

const (
	FileName      = ".plugin-state.sqlite"
	schemaVersion = 1
	catalogSchema = "CREATE TABLE catalog_state(singleton INTEGER PRIMARY KEY CHECK(singleton=1), revision INTEGER NOT NULL, payload BLOB NOT NULL)"
)

type schemaQueryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

// Initializer supplies a validated payload when no catalog row exists.
type Initializer func() ([]byte, error)

// Change transforms the current payload while the write transaction is held.
type Change func(current []byte) ([]byte, error)

// Store owns one bounded SQLite connection for one plugin profile.
type Store struct {
	path string

	lifecycleMu sync.Mutex
	opMu        sync.Mutex
	db          *sql.DB
	closed      bool
}

func New(pluginDir string) *Store {
	return &Store{path: filepath.Join(pluginDir, FileName)}
}

// NewAt opens the source-state database at an already-resolved path. It is
// used to validate detached backup/import artifacts without a live profile.
func NewAt(path string) *Store { return &Store{path: path} }

func Path(pluginDir string) string { return filepath.Join(pluginDir, FileName) }

func (s *Store) Path() string { return s.path }

func sqliteDSN(path string) string {
	normalized, host := sqliteURIPath(path)
	u := &url.URL{Scheme: "file", Host: host, Path: normalized}
	q := u.Query()
	q.Add("_pragma", "journal_mode(DELETE)")
	q.Add("_pragma", "synchronous(EXTRA)")
	q.Add("_pragma", "busy_timeout(5000)")
	q.Add("_pragma", "fullfsync(ON)")
	q.Set("_txlock", "immediate")
	u.RawQuery = q.Encode()
	return u.String()
}

func sqliteURIPath(path string) (normalized, host string) {
	normalized = strings.ReplaceAll(path, `\`, "/")
	if len(normalized) >= 3 && normalized[1] == ':' && normalized[2] == '/' {
		return "/" + normalized, ""
	}
	if strings.HasPrefix(normalized, "//") {
		rest := strings.TrimPrefix(normalized, "//")
		server, share, found := strings.Cut(rest, "/")
		if found && server != "" {
			return "/" + share, server
		}
	}
	return filepath.ToSlash(path), ""
}

func (s *Store) open(ctx context.Context, create bool) (*sql.DB, error) {
	s.lifecycleMu.Lock()
	defer s.lifecycleMu.Unlock()
	if s.closed {
		return nil, errors.New("extension source state is closed")
	}
	if s.db != nil {
		return s.db, nil
	}
	if !create {
		if _, err := os.Stat(s.path); err != nil {
			if os.IsNotExist(err) {
				return nil, nil
			}
			return nil, fmt.Errorf("inspect extension source state: %w", err)
		}
	} else if err := os.MkdirAll(filepath.Dir(s.path), 0o750); err != nil {
		return nil, fmt.Errorf("prepare extension source state: %w", err)
	}
	db, err := sql.Open("sqlite", sqliteDSN(s.path))
	if err != nil {
		return nil, fmt.Errorf("open extension source state: %w", err)
	}
	db.SetMaxOpenConns(1)
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("open extension source state: %w", err)
	}
	if err := verifyPragmas(ctx, db); err != nil {
		_ = db.Close()
		return nil, err
	}
	s.db = db
	return db, nil
}

func verifyPragmas(ctx context.Context, db *sql.DB) error {
	checks := []struct {
		query string
		want  string
	}{
		{"PRAGMA journal_mode", "delete"},
		{"PRAGMA synchronous", "3"},
		{"PRAGMA busy_timeout", "5000"},
	}
	if runtime.GOOS == "darwin" {
		checks = append(checks, struct{ query, want string }{"PRAGMA fullfsync", "1"})
	}
	for _, check := range checks {
		var got string
		if err := db.QueryRowContext(ctx, check.query).Scan(&got); err != nil {
			return fmt.Errorf("verify extension source state configuration: %w", err)
		}
		if strings.ToLower(got) != check.want {
			return fmt.Errorf("extension source state configuration %s is %q, want %q", check.query, got, check.want)
		}
	}
	return nil
}

// Load reads the authoritative row without creating a missing database.
func (s *Store) Load(ctx context.Context) (payload []byte, revision int64, present bool, err error) {
	s.opMu.Lock()
	defer s.opMu.Unlock()
	db, err := s.open(ctx, false)
	if err != nil || db == nil {
		return nil, 0, false, err
	}
	pristine, err := validateSchema(ctx, db)
	if err != nil {
		return nil, 0, false, err
	}
	if pristine {
		return nil, 0, false, nil
	}
	err = db.QueryRowContext(ctx, "SELECT revision, payload FROM catalog_state WHERE singleton = 1").Scan(&revision, &payload)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, 0, false, nil
	}
	if err != nil {
		return nil, 0, false, fmt.Errorf("read extension source state: %w", err)
	}
	return append([]byte(nil), payload...), revision, true, nil
}

// Update initializes if needed, applies change once, and atomically publishes
// a monotonically increasing revision.
func (s *Store) Update(ctx context.Context, initializer Initializer, change Change) ([]byte, int64, error) {
	s.opMu.Lock()
	defer s.opMu.Unlock()
	db, err := s.open(ctx, true)
	if err != nil {
		return nil, 0, err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return nil, 0, fmt.Errorf("begin extension source state update: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if err := ensureSchema(ctx, tx); err != nil {
		return nil, 0, err
	}
	var current []byte
	var revision int64
	priorPresent := true
	err = tx.QueryRowContext(ctx, "SELECT revision, payload FROM catalog_state WHERE singleton = 1").Scan(&revision, &current)
	if errors.Is(err, sql.ErrNoRows) {
		priorPresent = false
		current, err = initializer()
		if err != nil {
			return nil, 0, err
		}
		revision = 0
	} else if err != nil {
		return nil, 0, fmt.Errorf("read extension source state for update: %w", err)
	}
	next, err := change(append([]byte(nil), current...))
	if err != nil {
		return nil, 0, err
	}
	nextRevision := revision + 1
	if _, err := tx.ExecContext(ctx, `INSERT INTO catalog_state(singleton, revision, payload) VALUES(1, ?, ?)
		ON CONFLICT(singleton) DO UPDATE SET revision=excluded.revision, payload=excluded.payload`, nextRevision, next); err != nil {
		return nil, 0, fmt.Errorf("publish extension source state: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return s.resolveCommit(ctx, next, nextRevision, current, revision, priorPresent, err)
	}
	return append([]byte(nil), next...), nextRevision, nil
}

func (s *Store) resolveCommit(ctx context.Context, intended []byte, revision int64, prior []byte, priorRevision int64, priorPresent bool, commitErr error) ([]byte, int64, error) {
	var gotRevision int64
	var got []byte
	err := s.db.QueryRowContext(ctx, "SELECT revision, payload FROM catalog_state WHERE singleton = 1").Scan(&gotRevision, &got)
	if err == nil && gotRevision == revision && bytes.Equal(got, intended) {
		return append([]byte(nil), got...), gotRevision, nil
	}
	if err == nil && priorPresent && gotRevision == priorRevision && bytes.Equal(got, prior) {
		return nil, 0, fmt.Errorf("commit extension source state: %w", commitErr)
	}
	if errors.Is(err, sql.ErrNoRows) && !priorPresent {
		return nil, 0, fmt.Errorf("commit extension source state: %w", commitErr)
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, 0, fmt.Errorf("extension source state commit was uncertain and authoritative state could not be read: %w", err)
	}
	return nil, 0, fmt.Errorf("extension source state commit was uncertain: authoritative state differs from both the prior and intended revisions: %w", commitErr)
}

func validateSchema(ctx context.Context, db *sql.DB) (bool, error) {
	if err := validateIntegrity(ctx, db); err != nil {
		return false, err
	}
	return validateSchemaObjects(ctx, db)
}

func validateSchemaObjects(ctx context.Context, db schemaQueryer) (bool, error) {
	var version int
	if err := db.QueryRowContext(ctx, "PRAGMA user_version").Scan(&version); err != nil {
		return false, fmt.Errorf("read extension source schema: %w", err)
	}
	switch version {
	case 0:
		return validatePristineSchema(ctx, db)
	case schemaVersion:
		return false, validateCatalogSchema(ctx, db)
	default:
		return false, fmt.Errorf("extension source database schema %d is not supported", version)
	}
}

func validateIntegrity(ctx context.Context, db *sql.DB) error {
	var integrity string
	if err := db.QueryRowContext(ctx, "PRAGMA quick_check").Scan(&integrity); err != nil || integrity != "ok" {
		if err != nil {
			return fmt.Errorf("check extension source database integrity: %w", err)
		}
		return fmt.Errorf("extension source database failed integrity check: %s", integrity)
	}
	return nil
}

func validatePristineSchema(ctx context.Context, db schemaQueryer) (bool, error) {
	var count int
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM sqlite_schema").Scan(&count); err != nil {
		return false, fmt.Errorf("inspect extension source schema: %w", err)
	}
	if count != 0 {
		return false, errors.New("extension source database has an unrecognized unversioned schema")
	}
	return true, nil
}

func validateCatalogSchema(ctx context.Context, db schemaQueryer) error {
	rows, err := db.QueryContext(ctx, "SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name")
	if err != nil {
		return fmt.Errorf("inspect extension source schema: %w", err)
	}
	defer func() { _ = rows.Close() }()
	type schemaObject struct {
		typeName string
		name     string
		table    string
		sql      sql.NullString
	}
	var objects []schemaObject
	for rows.Next() {
		var object schemaObject
		if err := rows.Scan(&object.typeName, &object.name, &object.table, &object.sql); err != nil {
			return fmt.Errorf("inspect extension source schema: %w", err)
		}
		objects = append(objects, object)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("inspect extension source schema: %w", err)
	}
	if len(objects) != 1 {
		return fmt.Errorf("extension source database schema has unexpected objects: %v", objects)
	}
	object := objects[0]
	if object.typeName != "table" || object.name != "catalog_state" || object.table != "catalog_state" ||
		!object.sql.Valid || object.sql.String != catalogSchema {
		return errors.New("extension source database schema is incompatible")
	}
	return nil
}

func ensureSchema(ctx context.Context, tx *sql.Tx) error {
	pristine, err := validateSchemaObjects(ctx, tx)
	if err != nil {
		return err
	}
	if pristine {
		if _, err := tx.ExecContext(ctx, catalogSchema); err != nil {
			return fmt.Errorf("create extension source schema: %w", err)
		}
		if _, err := tx.ExecContext(ctx, "PRAGMA user_version = 1"); err != nil {
			return fmt.Errorf("version extension source schema: %w", err)
		}
		pristine, err = validateSchemaObjects(ctx, tx)
		if err != nil {
			return err
		}
		if pristine {
			return errors.New("extension source database schema initialization did not complete")
		}
	}
	return nil
}

// Close waits for the current operation, refuses future operations, and closes
// the owned connection.
func (s *Store) Close() error {
	s.opMu.Lock()
	defer s.opMu.Unlock()
	s.lifecycleMu.Lock()
	defer s.lifecycleMu.Unlock()
	s.closed = true
	if s.db == nil {
		return nil
	}
	err := s.db.Close()
	s.db = nil
	return err
}
