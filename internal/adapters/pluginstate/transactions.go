package pluginstate

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
)

// InstallTransactionRecord is one detached opaque service-owned journal row.
type InstallTransactionRecord struct {
	ID       string
	Revision int64
	Payload  []byte
}

type uncertainPublicationError struct{ detail string }

func (e uncertainPublicationError) Error() string              { return e.detail }
func (e uncertainPublicationError) PublicationUncertain() bool { return true }

// LoadApproval reads approval state without creating or migrating a database.
func (s *Store) LoadApproval(ctx context.Context) (payload []byte, revision int64, present bool, err error) {
	s.opMu.Lock()
	defer s.opMu.Unlock()
	db, err := s.open(ctx, false)
	if err != nil || db == nil {
		return nil, 0, false, err
	}
	pristine, err := validateSchema(ctx, db)
	if err != nil || pristine {
		return nil, 0, false, err
	}
	version, err := readSchemaVersion(ctx, db)
	if err != nil || version == catalogSchemaVersion {
		return nil, 0, false, err
	}
	err = db.QueryRowContext(ctx, "SELECT revision, payload FROM approval_state WHERE singleton = 1").Scan(&revision, &payload)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, 0, false, nil
	}
	if err != nil {
		return nil, 0, false, fmt.Errorf("read extension approval state: %w", err)
	}
	return append([]byte(nil), payload...), revision, true, nil
}

// UpdateApproval initializes schema and approval state if needed, then publishes one revision.
func (s *Store) UpdateApproval(ctx context.Context, catalogInitializer Initializer, approvalInitializer Initializer, change Change) ([]byte, int64, error) {
	s.opMu.Lock()
	defer s.opMu.Unlock()
	db, err := s.open(ctx, true)
	if err != nil {
		return nil, 0, err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return nil, 0, fmt.Errorf("begin extension approval update: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := ensureTransactionSchema(ctx, tx, catalogInitializer); err != nil {
		return nil, 0, err
	}
	current, revision, present, err := readSingleton(ctx, tx, "approval_state")
	if err != nil {
		return nil, 0, fmt.Errorf("read extension approval state for update: %w", err)
	}
	if !present {
		current, err = approvalInitializer()
		if err != nil {
			return nil, 0, err
		}
	}
	next, err := change(append([]byte(nil), current...))
	if err != nil {
		return nil, 0, err
	}
	nextRevision := revision + 1
	if _, err := tx.ExecContext(ctx, `INSERT INTO approval_state(singleton, revision, payload) VALUES(1, ?, ?)
		ON CONFLICT(singleton) DO UPDATE SET revision=excluded.revision, payload=excluded.payload`, nextRevision, next); err != nil {
		return nil, 0, fmt.Errorf("publish extension approval state: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return s.resolveApprovalCommit(ctx, next, nextRevision, current, revision, present, err)
	}
	return append([]byte(nil), next...), nextRevision, nil
}

// ListInstallTransactions reads all journal rows without creating schema 2.
func (s *Store) ListInstallTransactions(ctx context.Context) ([]InstallTransactionRecord, error) {
	s.opMu.Lock()
	defer s.opMu.Unlock()
	db, err := s.open(ctx, false)
	if err != nil || db == nil {
		return nil, err
	}
	pristine, err := validateSchema(ctx, db)
	if err != nil || pristine {
		return nil, err
	}
	version, err := readSchemaVersion(ctx, db)
	if err != nil || version == catalogSchemaVersion {
		return nil, err
	}
	rows, err := db.QueryContext(ctx, "SELECT transaction_id, revision, payload FROM install_transactions ORDER BY transaction_id")
	if err != nil {
		return nil, fmt.Errorf("list extension install transactions: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var records []InstallTransactionRecord
	for rows.Next() {
		var record InstallTransactionRecord
		if err := rows.Scan(&record.ID, &record.Revision, &record.Payload); err != nil {
			return nil, fmt.Errorf("read extension install transaction: %w", err)
		}
		record.Payload = append([]byte(nil), record.Payload...)
		records = append(records, record)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list extension install transactions: %w", err)
	}
	return records, nil
}

// CompareAndSwapInstallTransaction inserts at revision zero or replaces the named revision.
func (s *Store) CompareAndSwapInstallTransaction(ctx context.Context, catalogInitializer Initializer, id string, expectedRevision int64, payload []byte) (int64, error) {
	if id == "" || expectedRevision < 0 || len(payload) == 0 {
		return 0, errors.New("extension install transaction requires a nonempty payload and nonnegative revision")
	}
	s.opMu.Lock()
	defer s.opMu.Unlock()
	db, err := s.open(ctx, true)
	if err != nil {
		return 0, err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin extension install transaction update: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := ensureTransactionSchema(ctx, tx, catalogInitializer); err != nil {
		return 0, err
	}
	prior, revision, present, err := readTransaction(ctx, tx, id)
	if err != nil {
		return 0, err
	}
	if transactionRevisionChanged(expectedRevision, revision, present) {
		return 0, fmt.Errorf("extension install transaction %q revision changed", id)
	}
	nextRevision := expectedRevision + 1
	if err := publishTransactionRow(ctx, tx, id, expectedRevision, nextRevision, payload); err != nil {
		return 0, fmt.Errorf("publish extension install transaction: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return s.resolveTransactionCommit(ctx, id, payload, nextRevision, prior, revision, present, err)
	}
	return nextRevision, nil
}

func transactionRevisionChanged(expected, current int64, present bool) bool {
	return expected == 0 && present || expected > 0 && (!present || current != expected)
}

func publishTransactionRow(ctx context.Context, tx *sql.Tx, id string, expected, next int64, payload []byte) error {
	var (
		result sql.Result
		err    error
	)
	if expected == 0 {
		result, err = tx.ExecContext(ctx, "INSERT INTO install_transactions(transaction_id, revision, payload) VALUES(?, ?, ?)", id, next, payload)
	} else {
		result, err = tx.ExecContext(ctx, "UPDATE install_transactions SET revision = ?, payload = ? WHERE transaction_id = ? AND revision = ?", next, payload, id, expected)
	}
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected != 1 {
		return fmt.Errorf("extension install transaction %q revision changed", id)
	}
	return nil
}

// DeleteInstallTransaction removes only the named current revision.
func (s *Store) DeleteInstallTransaction(ctx context.Context, id string, expectedRevision int64) error {
	if expectedRevision <= 0 {
		return errors.New("extension install transaction deletion requires a positive revision")
	}
	s.opMu.Lock()
	defer s.opMu.Unlock()
	db, err := s.open(ctx, false)
	if err != nil {
		return err
	}
	if db == nil {
		return fmt.Errorf("extension install transaction %q revision changed", id)
	}
	pristine, err := validateSchema(ctx, db)
	if err != nil {
		return err
	}
	if pristine {
		return fmt.Errorf("extension install transaction %q revision changed", id)
	}
	version, err := readSchemaVersion(ctx, db)
	if err != nil {
		return err
	}
	if version == catalogSchemaVersion {
		return fmt.Errorf("extension install transaction %q revision changed", id)
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin extension install transaction deletion: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	prior, revision, present, err := readTransaction(ctx, tx, id)
	if err != nil {
		return err
	}
	if !present || revision != expectedRevision {
		return fmt.Errorf("extension install transaction %q revision changed", id)
	}
	result, err := tx.ExecContext(ctx, "DELETE FROM install_transactions WHERE transaction_id = ? AND revision = ?", id, expectedRevision)
	if err != nil {
		return fmt.Errorf("delete extension install transaction: %w", err)
	}
	affected, countErr := result.RowsAffected()
	if countErr != nil {
		return fmt.Errorf("delete extension install transaction: %w", countErr)
	}
	if affected != 1 {
		return fmt.Errorf("extension install transaction %q revision changed", id)
	}
	if err := tx.Commit(); err != nil {
		return resolveTransactionDelete(ctx, db, id, revision, prior, err)
	}
	return nil
}

func resolveTransactionDelete(ctx context.Context, db *sql.DB, id string, priorRevision int64, prior []byte, commitErr error) error {
	got, gotRevision, gotPresent, err := readTransaction(ctx, db, id)
	if err == nil && !gotPresent {
		return nil
	}
	if err == nil && gotPresent && gotRevision == priorRevision && bytes.Equal(got, prior) {
		return fmt.Errorf("delete extension install transaction: %w", commitErr)
	}
	return uncertainPublicationError{detail: fmt.Sprintf("extension install transaction delete was uncertain: %v", commitErr)}
}

func ensureTransactionSchema(ctx context.Context, tx *sql.Tx, catalogInitializer Initializer) error {
	pristine, err := validateSchemaObjects(ctx, tx)
	if err != nil {
		return err
	}
	if pristine {
		if err := initializeCatalogSchema(ctx, tx, catalogInitializer); err != nil {
			return err
		}
	}
	version, err := readSchemaVersion(ctx, tx)
	if err != nil {
		return err
	}
	if version == catalogSchemaVersion {
		if err := upgradeTransactionSchema(ctx, tx); err != nil {
			return err
		}
	}
	_, err = validateSchemaObjects(ctx, tx)
	return err
}

func initializeCatalogSchema(ctx context.Context, tx *sql.Tx, initializer Initializer) error {
	payload, err := initializer()
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, catalogSchema); err != nil {
		return fmt.Errorf("create extension source schema: %w", err)
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO catalog_state(singleton, revision, payload) VALUES(1, 1, ?)", payload); err != nil {
		return fmt.Errorf("initialize extension source state: %w", err)
	}
	if _, err := tx.ExecContext(ctx, "PRAGMA user_version = 1"); err != nil {
		return fmt.Errorf("version extension source schema: %w", err)
	}
	return nil
}

func upgradeTransactionSchema(ctx context.Context, tx *sql.Tx) error {
	if _, err := tx.ExecContext(ctx, installTransactionsSchema); err != nil {
		return fmt.Errorf("create extension install journal: %w", err)
	}
	if _, err := tx.ExecContext(ctx, approvalSchema); err != nil {
		return fmt.Errorf("create extension approval state: %w", err)
	}
	if _, err := tx.ExecContext(ctx, "PRAGMA user_version = 2"); err != nil {
		return fmt.Errorf("version extension source schema: %w", err)
	}
	return nil
}

func readSchemaVersion(ctx context.Context, q schemaQueryer) (int, error) {
	var version int
	if err := q.QueryRowContext(ctx, "PRAGMA user_version").Scan(&version); err != nil {
		return 0, fmt.Errorf("read extension source schema: %w", err)
	}
	return version, nil
}

func readSingleton(ctx context.Context, q schemaQueryer, table string) ([]byte, int64, bool, error) {
	var payload []byte
	var revision int64
	err := q.QueryRowContext(ctx, "SELECT revision, payload FROM "+table+" WHERE singleton = 1").Scan(&revision, &payload)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, 0, false, nil
	}
	return append([]byte(nil), payload...), revision, err == nil, err
}

func readTransaction(ctx context.Context, q schemaQueryer, id string) ([]byte, int64, bool, error) {
	var payload []byte
	var revision int64
	err := q.QueryRowContext(ctx, "SELECT revision, payload FROM install_transactions WHERE transaction_id = ?", id).Scan(&revision, &payload)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, 0, false, nil
	}
	if err != nil {
		return nil, 0, false, fmt.Errorf("read extension install transaction: %w", err)
	}
	return append([]byte(nil), payload...), revision, true, nil
}

func (s *Store) resolveApprovalCommit(ctx context.Context, intended []byte, revision int64, prior []byte, priorRevision int64, priorPresent bool, commitErr error) ([]byte, int64, error) {
	got, gotRevision, gotPresent, err := readSingleton(ctx, s.db, "approval_state")
	if err == nil && gotPresent && gotRevision == revision && bytes.Equal(got, intended) {
		return got, gotRevision, nil
	}
	if err == nil && gotPresent == priorPresent && gotRevision == priorRevision && bytes.Equal(got, prior) {
		return nil, 0, fmt.Errorf("commit extension approval state: %w", commitErr)
	}
	if err != nil {
		return nil, 0, uncertainPublicationError{detail: fmt.Sprintf("extension approval state commit was uncertain and authoritative state could not be read: %v", err)}
	}
	return nil, 0, uncertainPublicationError{detail: fmt.Sprintf("extension approval state commit was uncertain: authoritative state differs from both prior and intended revisions: %v", commitErr)}
}

func (s *Store) resolveTransactionCommit(ctx context.Context, id string, intended []byte, revision int64, prior []byte, priorRevision int64, priorPresent bool, commitErr error) (int64, error) {
	got, gotRevision, gotPresent, err := readTransaction(ctx, s.db, id)
	if err == nil && gotPresent && gotRevision == revision && bytes.Equal(got, intended) {
		return gotRevision, nil
	}
	if err == nil && gotPresent == priorPresent && gotRevision == priorRevision && bytes.Equal(got, prior) {
		return 0, fmt.Errorf("commit extension install transaction: %w", commitErr)
	}
	if err != nil {
		return 0, uncertainPublicationError{detail: fmt.Sprintf("extension install transaction commit was uncertain and authoritative state could not be read: %v", err)}
	}
	return 0, uncertainPublicationError{detail: fmt.Sprintf("extension install transaction commit was uncertain: authoritative state differs from both prior and intended revisions: %v", commitErr)}
}
