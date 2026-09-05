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

// vaultBackupName is the vault's own filename inside every backup
// subdirectory -- unrelated to secretvault's own ".bak.kdbx" archive
// naming (a per-reset history beside the live file); this is one
// snapshot's own copy, rotated by the same keepN prune as
// execution.db/settings.json.
const vaultBackupName = "secrets.kdbx"

// Result is one completed Snapshot call's outcome.
type Result struct {
	// Dir is the backup's own subdirectory (dir/<timestamp>), holding
	// execution.db and, when settingsPath/vaultPath were non-empty,
	// settings.json/secrets.kdbx.
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
// VACUUM INTO copy, integrity-checked, plus a settingsPath copy and a
// vaultPath copy alongside it. The vault copy is the encrypted KDBX
// file only -- its master key lives solely in the OS keychain (goal
// 0330) and is never backed up, matching KeePassXC's own "back up the
// file, never the key" precedent. Prunes dir back down to its keepN
// most-recent backups afterward (keepN <= 0 disables pruning -- never
// silently unbounded).
//
// Safe to call while dbPath has concurrent readers/writers: VACUUM
// INTO reads its source inside one read transaction (sqlite.org's own
// documented guarantee), so it neither blocks nor is blocked by an
// ordinary writer beyond a single commit's duration. settingsPath/
// vaultPath are plain file copies, safe for the same reason
// copyFile's own doc comment gives: neither is a live SQLite file held
// open mid-write.
func Snapshot(dbPath, settingsPath, vaultPath, dir string, keepN int) (Result, error) {
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
		if err := copyFile(settingsPath, filepath.Join(backupDir, "settings.json")); err != nil {
			return Result{}, err
		}
	}
	if vaultPath != "" {
		if err := copyFile(vaultPath, filepath.Join(backupDir, vaultBackupName)); err != nil {
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

// copyFile copies src to dst byte-for-byte -- a plain copy is safe for
// both of this package's callers (unlike the live execution database
// above): settings.json is a single-writer, atomically-rewritten KV
// file (internal/adapters/settings), and the vault KDBX file is
// rewritten whole on each save (gokeepasslib's own encoder, never an
// in-place mutation) -- neither is ever held open mid-write across a
// scheduler tick. A missing src (no settings file, or no vault, yet on
// a genuinely fresh install) is not an error -- the backup still
// proceeds with whatever else it has.
func copyFile(src, dst string) error {
	in, err := os.Open(src) //nolint:gosec // Mill-owned source path, wired by main.go, not external input
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("backup: open %s: %w", src, err)
	}
	defer func() { _ = in.Close() }()

	out, err := os.Create(dst) //nolint:gosec // Mill-owned backup path, wired by main.go, not external input
	if err != nil {
		return fmt.Errorf("backup: create copy of %s: %w", src, err)
	}
	if _, err := io.Copy(out, in); err != nil {
		_ = out.Close()
		return fmt.Errorf("backup: copy %s: %w", src, err)
	}
	return out.Close()
}

// RestoreVault copies backupDir's own vault copy (written by Snapshot
// when a vault existed at backup time) to targetPath, but ONLY when
// targetPath has nothing there yet: restoring over a live vault file is
// never implicit -- the key that opens targetPath's CURRENT file, if
// any, is not guaranteed to open the restored one, so that has to be a
// separate, deliberate action. Returns whether a restore actually
// happened; (false, nil) means targetPath already had a file, left
// untouched. A source backup carrying no vault (taken before this
// device ever had one, or since pruned past keepN) is a real error, not
// a silent no-op.
func RestoreVault(backupDir, targetPath string) (bool, error) {
	src := filepath.Join(backupDir, vaultBackupName)
	if _, err := os.Stat(src); err != nil {
		return false, fmt.Errorf("backup: restore vault: no vault in this backup: %w", err)
	}
	if _, err := os.Stat(targetPath); err == nil {
		return false, nil
	} else if !os.IsNotExist(err) {
		return false, fmt.Errorf("backup: restore vault: checking target: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(targetPath), 0o700); err != nil {
		return false, fmt.Errorf("backup: restore vault: preparing target directory: %w", err)
	}
	if err := copyFile(src, targetPath); err != nil {
		return false, err
	}
	return true, nil
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

// LatestWithVault returns the newest backup's own time whose
// subdirectory carries a copy of the vault file, or the zero time if
// none does -- distinct from Latest, which answers about ANY backup
// regardless of what it carries: a vault set up after the oldest kept
// backups already rotated off leaves those without one.
func LatestWithVault(dir string) (time.Time, error) {
	_, t, err := LatestVaultBackupDir(dir)
	return t, err
}

// LatestVaultBackupDir returns the newest backup's own directory path
// and time whose subdirectory carries a copy of the vault file, or ""
// and the zero time if none does -- the actual directory RestoreVault's
// own backupDir argument expects, once a caller already knows one
// exists (goal 0359's own recovery door reads this directly rather than
// re-deriving a path from LatestWithVault's time alone). Walks newest
// to oldest and stops at the first hit, so this costs one stat per
// backup back to the answer, never a full directory scan.
func LatestVaultBackupDir(dir string) (string, time.Time, error) {
	names, err := backupDirNames(dir)
	if err != nil {
		return "", time.Time{}, err
	}
	for i := len(names) - 1; i >= 0; i-- {
		backupDir := filepath.Join(dir, names[i])
		if _, err := os.Stat(filepath.Join(backupDir, vaultBackupName)); err != nil {
			continue
		}
		t, err := time.ParseInLocation(TimestampLayout, names[i], time.Local)
		if err != nil {
			return "", time.Time{}, fmt.Errorf("backup: parse backup name %q: %w", names[i], err)
		}
		return backupDir, t, nil
	}
	return "", time.Time{}, nil
}

// ConsumeVaultBackup removes ONLY the vault copy from backupDir (one
// specific backup's own subdirectory, as returned by
// LatestVaultBackupDir) -- everything else that backup carries
// (execution.db/settings.json) is untouched. Called after a successful
// RestoreVault from this same directory, so a repeated restore-from-
// backup attempt (the key still doesn't fit) moves on to the next-older
// backup that still carries its own vault copy, rather than restoring
// the exact same already-tried file again. A backup with no vault copy
// to begin with is not an error -- there is nothing to consume.
func ConsumeVaultBackup(backupDir string) error {
	if err := os.Remove(filepath.Join(backupDir, vaultBackupName)); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("backup: consume vault copy: %w", err)
	}
	return nil
}
