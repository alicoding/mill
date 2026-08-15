// Package backup implements Mill's own live-database snapshot
// primitive (docs/goals/0065): a `VACUUM INTO` copy of the execution
// SQLite database -- sqlite.org's own sanctioned safe-live-snapshot
// mechanism, never a plain file copy, which is a documented corruption
// risk against a database with an open writer -- verified with
// `PRAGMA integrity_check` against the produced file, plus a plain
// copy of the settings JSON alongside it (safe as a plain copy: it's
// not a live SQLite file). Reuses the same modernc.org/sqlite driver
// the DBOS execution adapter (internal/adapters/execution) already
// depends on -- no new dependency, per .claude/rules/architecture.md's
// adopt-over-hand-roll rule.
package backup

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"time"

	_ "modernc.org/sqlite" // registers the "sqlite" database/sql driver name
)

// TimestampLayout names each backup's own subdirectory --
// lexicographically sortable, so keep-N pruning and "most recent"
// lookups never need to parse a timestamp back out of a directory
// name via anything but string comparison. Millisecond precision
// (".000") rather than whole seconds: two Snapshot calls issued back
// to back (a double-clicked "Back up now", export-everything's own
// throwaway snapshot alongside a real one in the same second) would
// otherwise mint the identical directory name and collide.
const TimestampLayout = "20060102-150405.000"

// Result is one completed Snapshot call's outcome.
type Result struct {
	// Dir is the backup's own subdirectory (dir/<timestamp>), holding
	// execution.db and, when settingsPath was non-empty, settings.json.
	Dir     string
	TakenAt time.Time
	// Pruned lists the older backup subdirectory names removed to
	// respect keepN.
	Pruned []string
}

// Snapshot takes one backup of dbPath (a plain sqlite file path, never
// a "sqlite:"-prefixed DSN -- callers strip that themselves, the same
// scheme-is-the-caller's-decision layering internal/adapters/execution
// already documents) into a freshly timestamped subdirectory of dir: a
// VACUUM INTO copy, integrity-checked, plus a settingsPath copy
// alongside it. Prunes dir back down to its keepN most-recent backups
// afterward (keepN <= 0 disables pruning -- never silently unbounded).
//
// Safe to call while dbPath has concurrent readers/writers: VACUUM
// INTO reads its source inside one read transaction (sqlite.org's own
// documented guarantee), so it neither blocks nor is blocked by an
// ordinary writer beyond a single commit's duration.
func Snapshot(dbPath, settingsPath, dir string, keepN int) (Result, error) {
	now := time.Now()
	backupDir := filepath.Join(dir, now.Format(TimestampLayout))
	if err := os.MkdirAll(backupDir, 0o750); err != nil {
		return Result{}, fmt.Errorf("backup: create backup dir: %w", err)
	}

	snapshotPath := filepath.Join(backupDir, "execution.db")
	if err := vacuumInto(dbPath, snapshotPath); err != nil {
		return Result{}, err
	}
	if err := verifyIntegrity(snapshotPath); err != nil {
		return Result{}, err
	}
	if settingsPath != "" {
		if err := copySettings(settingsPath, filepath.Join(backupDir, "settings.json")); err != nil {
			return Result{}, err
		}
	}

	pruned, err := prune(dir, keepN)
	if err != nil {
		return Result{Dir: backupDir, TakenAt: now}, err
	}
	return Result{Dir: backupDir, TakenAt: now, Pruned: pruned}, nil
}

// vacuumIntoBusyTimeout bounds how long VACUUM INTO retries against a
// SQLITE_BUSY from a concurrent writer holding the database's one
// write lock, rather than failing the backup on the first transient
// collision -- the same retry-not-fail posture a real writer (DBOS's
// own sqlite connection) already takes via its own busy_timeout.
const vacuumIntoBusyTimeout = 5000 // milliseconds

// vacuumInto opens dbPath as its own, independent *sql.DB (VACUUM
// cannot run inside a transaction another handle already holds open)
// and runs `VACUUM INTO ?` -- SQLite accepts a bound parameter as the
// target-filename expression, confirmed directly against sqlite.org's
// VACUUM documentation before relying on it rather than assumed, so
// snapshotPath never needs manual quote-escaping into the SQL text.
func vacuumInto(dbPath, snapshotPath string) error {
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return fmt.Errorf("backup: open source database: %w", err)
	}
	defer func() { _ = db.Close() }()

	ctx := context.Background()
	if _, err := db.ExecContext(ctx, fmt.Sprintf("PRAGMA busy_timeout = %d", vacuumIntoBusyTimeout)); err != nil {
		return fmt.Errorf("backup: set busy_timeout: %w", err)
	}
	if _, err := db.ExecContext(ctx, "VACUUM INTO ?", snapshotPath); err != nil {
		return fmt.Errorf("backup: vacuum into snapshot: %w", err)
	}
	return nil
}

// verifyIntegrity opens the just-produced snapshot as its own
// connection and runs PRAGMA integrity_check -- sqlite.org's own
// recommended check after any offline database copy, confirming the
// VACUUM INTO output is a genuinely well-formed database, not just a
// file that happens to exist.
func verifyIntegrity(snapshotPath string) error {
	db, err := sql.Open("sqlite", snapshotPath)
	if err != nil {
		return fmt.Errorf("backup: open snapshot for integrity check: %w", err)
	}
	defer func() { _ = db.Close() }()

	rows, err := db.QueryContext(context.Background(), "PRAGMA integrity_check")
	if err != nil {
		return fmt.Errorf("backup: integrity check: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var results []string
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			return fmt.Errorf("backup: integrity check: read result: %w", err)
		}
		results = append(results, line)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("backup: integrity check: %w", err)
	}
	if len(results) != 1 || results[0] != "ok" {
		return fmt.Errorf("backup: snapshot failed integrity check: %v", results)
	}
	return nil
}

// copySettings copies src to dst byte-for-byte -- a plain copy is safe
// here (unlike the live execution database above): settings.json is a
// single-writer, atomically-rewritten KV file
// (internal/adapters/settings), never held open mid-write across a
// scheduler tick. A missing src (no settings file yet on a genuinely
// fresh install) is not an error -- the backup still proceeds with
// just the database snapshot.
func copySettings(src, dst string) error {
	in, err := os.Open(src) //nolint:gosec // Mill-owned settings path, wired by main.go, not external input
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("backup: open settings file: %w", err)
	}
	defer func() { _ = in.Close() }()

	out, err := os.Create(dst) //nolint:gosec // Mill-owned backup path, wired by main.go, not external input
	if err != nil {
		return fmt.Errorf("backup: create settings copy: %w", err)
	}
	if _, err := io.Copy(out, in); err != nil {
		_ = out.Close()
		return fmt.Errorf("backup: copy settings file: %w", err)
	}
	return out.Close()
}

// backupDirNames lists dir's own backup subdirectories (each named per
// TimestampLayout), lexicographically ascending -- oldest first. A
// non-existent dir (nothing backed up yet) returns an empty list, not
// an error.
func backupDirNames(dir string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("backup: list backups: %w", err)
	}
	var names []string
	for _, e := range entries {
		if e.IsDir() {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	return names, nil
}

// prune keeps dir's keepN most-recent backup subdirectories and
// removes the rest, returning the names removed. keepN <= 0 is a
// no-op -- pruning is opt-in, never a silent unbounded delete.
func prune(dir string, keepN int) ([]string, error) {
	if keepN <= 0 {
		return nil, nil
	}
	names, err := backupDirNames(dir)
	if err != nil {
		return nil, err
	}
	if len(names) <= keepN {
		return nil, nil
	}
	toRemove := names[:len(names)-keepN]
	var removed []string
	for _, name := range toRemove {
		if err := os.RemoveAll(filepath.Join(dir, name)); err != nil {
			return removed, fmt.Errorf("backup: prune %q: %w", name, err)
		}
		removed = append(removed, name)
	}
	return removed, nil
}

// Latest returns the most recent backup's own timestamp, or the zero
// time if dir has no backups yet -- used to skip a redundant
// clean-shutdown snapshot (main.go) when one already ran recently, and
// to surface "last backup time" in Settings.
func Latest(dir string) (time.Time, error) {
	names, err := backupDirNames(dir)
	if err != nil {
		return time.Time{}, err
	}
	if len(names) == 0 {
		return time.Time{}, nil
	}
	latest := names[len(names)-1]
	t, err := time.ParseInLocation(TimestampLayout, latest, time.Local)
	if err != nil {
		return time.Time{}, fmt.Errorf("backup: parse latest backup name %q: %w", latest, err)
	}
	return t, nil
}
