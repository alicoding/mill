package backup

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

// newTestDB creates a real sqlite file with one table and a handful of
// rows -- enough for VACUUM INTO to have real content to copy and for
// integrity_check to have something genuine to verify.
func newTestDB(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "execution.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	defer func() { _ = db.Close() }()

	if _, err := db.ExecContext(context.Background(), `CREATE TABLE steps (id INTEGER PRIMARY KEY, payload TEXT)`); err != nil {
		t.Fatalf("create table: %v", err)
	}
	for i := 0; i < 10; i++ {
		if _, err := db.ExecContext(context.Background(), `INSERT INTO steps (payload) VALUES (?)`, fmt.Sprintf("row-%d", i)); err != nil {
			t.Fatalf("insert: %v", err)
		}
	}
	return path
}

func TestSnapshot_ProducesAnIntegrityCheckedCopy(t *testing.T) {
	dbPath := newTestDB(t)
	backupDir := t.TempDir()

	result, err := Snapshot(dbPath, "", backupDir, 10)
	if err != nil {
		t.Fatalf("Snapshot: %v", err)
	}

	snapshotPath := filepath.Join(result.Dir, "execution.db")
	if _, err := os.Stat(snapshotPath); err != nil {
		t.Fatalf("snapshot file missing: %v", err)
	}
	// verifyIntegrity already ran inside Snapshot and would have
	// returned an error on a corrupt copy -- re-run it here directly so
	// this test pins the property (a genuinely well-formed database),
	// not just "Snapshot didn't error".
	if err := verifyIntegrity(snapshotPath); err != nil {
		t.Errorf("produced snapshot failed its own integrity check: %v", err)
	}

	db, err := sql.Open("sqlite", snapshotPath)
	if err != nil {
		t.Fatalf("open snapshot: %v", err)
	}
	defer func() { _ = db.Close() }()
	var count int
	if err := db.QueryRowContext(context.Background(), `SELECT COUNT(*) FROM steps`).Scan(&count); err != nil {
		t.Fatalf("count rows: %v", err)
	}
	if count != 10 {
		t.Errorf("snapshot has %d rows, want 10 (all rows copied)", count)
	}
}

func TestSnapshot_CopiesSettingsAlongside(t *testing.T) {
	dbPath := newTestDB(t)
	backupDir := t.TempDir()
	settingsPath := filepath.Join(t.TempDir(), "settings.json")
	if err := os.WriteFile(settingsPath, []byte(`{"key":"value"}`), 0o600); err != nil {
		t.Fatalf("write settings fixture: %v", err)
	}

	result, err := Snapshot(dbPath, settingsPath, backupDir, 10)
	if err != nil {
		t.Fatalf("Snapshot: %v", err)
	}

	got, err := os.ReadFile(filepath.Join(result.Dir, "settings.json")) //nolint:gosec // t.TempDir()-scoped test fixture path
	if err != nil {
		t.Fatalf("read copied settings: %v", err)
	}
	if string(got) != `{"key":"value"}` {
		t.Errorf("copied settings content = %q, want the exact source content", got)
	}
}

func TestSnapshot_MissingSettingsFileIsNotAnError(t *testing.T) {
	dbPath := newTestDB(t)
	backupDir := t.TempDir()

	_, err := Snapshot(dbPath, filepath.Join(t.TempDir(), "does-not-exist.json"), backupDir, 10)
	if err != nil {
		t.Fatalf("Snapshot with no settings file yet = %v, want success (a fresh install has none)", err)
	}
}

// TestSnapshot_SafeWhileConcurrentWritesRun is this goal's concurrency
// proof (docs/goals/0065's acceptance criterion): VACUUM INTO must
// succeed and integrity-check clean even while another connection is
// actively inserting rows into the same database file, the same shape
// a real backup running while workflow runs are executing takes.
func TestSnapshot_SafeWhileConcurrentWritesRun(t *testing.T) {
	dbPath := newTestDB(t)
	backupDir := t.TempDir()

	writer, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open writer connection: %v", err)
	}
	defer func() { _ = writer.Close() }()
	// A busy_timeout keeps a writer's transient SQLITE_BUSY (from
	// VACUUM INTO's own read lock) retried instead of surfacing as a
	// hard failure -- the real posture executionsvc's own DBOS/sqlite
	// connection already takes, confirmed against modernc.org/sqlite's
	// PRAGMA support.
	if _, err := writer.ExecContext(context.Background(), `PRAGMA busy_timeout = 5000`); err != nil {
		t.Fatalf("set busy_timeout: %v", err)
	}

	stop := make(chan struct{})
	var writeErr error
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		i := 0
		for {
			select {
			case <-stop:
				return
			default:
			}
			if _, err := writer.ExecContext(context.Background(), `INSERT INTO steps (payload) VALUES (?)`, fmt.Sprintf("concurrent-%d", i)); err != nil {
				writeErr = err
				return
			}
			i++
			time.Sleep(time.Millisecond)
		}
	}()

	result, snapErr := Snapshot(dbPath, "", backupDir, 10)
	close(stop)
	wg.Wait()

	if writeErr != nil {
		t.Fatalf("concurrent writer failed: %v", writeErr)
	}
	if snapErr != nil {
		t.Fatalf("Snapshot while writes were in flight: %v", snapErr)
	}
	if err := verifyIntegrity(filepath.Join(result.Dir, "execution.db")); err != nil {
		t.Errorf("snapshot taken under concurrent writes failed integrity check: %v", err)
	}
}

func TestSnapshot_PrunesToKeepN(t *testing.T) {
	dbPath := newTestDB(t)
	backupDir := t.TempDir()

	var lastResult Result
	for i := 0; i < 5; i++ {
		result, err := Snapshot(dbPath, "", backupDir, 3)
		if err != nil {
			t.Fatalf("Snapshot #%d: %v", i, err)
		}
		lastResult = result
		// TimestampLayout has millisecond resolution -- a short sleep is
		// still cheap insurance against two iterations landing in the
		// exact same millisecond on a fast test runner.
		time.Sleep(2 * time.Millisecond)
	}

	names, err := backupDirNames(backupDir)
	if err != nil {
		t.Fatalf("backupDirNames: %v", err)
	}
	if len(names) != 3 {
		t.Errorf("backup dir has %d entries after keepN=3, want exactly 3", len(names))
	}
	if len(lastResult.Pruned) == 0 {
		t.Error("Result.Pruned is empty, want the earlier snapshots it removed")
	}
}

func TestSnapshot_KeepNZeroDisablesPruning(t *testing.T) {
	dbPath := newTestDB(t)
	backupDir := t.TempDir()

	for i := 0; i < 3; i++ {
		if _, err := Snapshot(dbPath, "", backupDir, 0); err != nil {
			t.Fatalf("Snapshot #%d: %v", i, err)
		}
		time.Sleep(2 * time.Millisecond)
	}

	names, err := backupDirNames(backupDir)
	if err != nil {
		t.Fatalf("backupDirNames: %v", err)
	}
	if len(names) != 3 {
		t.Errorf("backup dir has %d entries with keepN=0, want all 3 kept", len(names))
	}
}

func TestLatest_EmptyDirReturnsZeroTime(t *testing.T) {
	got, err := Latest(filepath.Join(t.TempDir(), "never-created"))
	if err != nil {
		t.Fatalf("Latest on a never-created dir: %v", err)
	}
	if !got.IsZero() {
		t.Errorf("Latest() = %v, want zero time for no backups yet", got)
	}
}

func TestLatest_ReturnsMostRecentBackupTime(t *testing.T) {
	dbPath := newTestDB(t)
	backupDir := t.TempDir()

	first, err := Snapshot(dbPath, "", backupDir, 10)
	if err != nil {
		t.Fatalf("first Snapshot: %v", err)
	}
	time.Sleep(2 * time.Millisecond)
	second, err := Snapshot(dbPath, "", backupDir, 10)
	if err != nil {
		t.Fatalf("second Snapshot: %v", err)
	}

	got, err := Latest(backupDir)
	if err != nil {
		t.Fatalf("Latest: %v", err)
	}
	if got.Before(first.TakenAt) || got.Before(second.TakenAt.Add(-time.Second)) {
		t.Errorf("Latest() = %v, want at/after the second snapshot's own time %v", got, second.TakenAt)
	}
}
