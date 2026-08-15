// Package backupsvc is the Wails-facing layer over Mill's own
// data-stewardship surface (docs/goals/0065): on-demand and
// clean-shutdown snapshots of the execution database + settings (via
// internal/adapters/backup's VACUUM INTO primitive), and the
// export-everything/import-everything archive bundling every
// ADR-0036 entity-family envelope alongside a fresh snapshot. Owns no
// domain storage of its own -- every family it bundles is exported/
// imported through that family's own existing service method, wired
// in from main.go once those services exist (.claude/rules/
// backend.md: composition/configure/atlas each already own their
// entity's persistence, so this package only orchestrates their
// already-public Export*/Import* methods, never duplicates them).
package backupsvc

import (
	"fmt"
	"sync"
	"time"

	"github.com/alicoding/mill/internal/adapters/backup"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// DefaultKeepN is BackupNow's own retention -- the same default the
// seeded "Backup Mill data" workflow's keepN field ships with
// (composition.defaultBackupKeepN).
const DefaultKeepN = 10

// SkipIfWithin is the clean-shutdown hook's own "don't bother, one
// already ran recently" window (docs/goals/0065 item 3).
const SkipIfWithin = time.Hour

// BackupService takes the execution-db/settings paths as plain values
// (never a "sqlite:"-prefixed DSN -- main.go's own scheme-stripping
// decision, matching internal/adapters/execution.New's layering)
// rather than owning any live connection itself: every backup is a
// fresh, independent database/sql.Open inside
// internal/adapters/backup.Snapshot. dbPath is empty when the running
// instance is configured against a non-sqlite DatabaseURL
// (docs/goals/0065 item 6's BYO-Postgres door) -- VACUUM INTO only
// applies to a local sqlite file, so backups are unavailable in that
// configuration, reported as a real error rather than silently
// no-op'ing.
type BackupService struct {
	mu           sync.Mutex
	dbPath       string
	settingsPath string
	dir          string
	millVersion  string

	families []FamilyBundle
	atlas    atlasBundle
}

// New constructs a BackupService against dbPath (a plain sqlite file
// path, or "" for a non-sqlite deployment)/settingsPath/dir (the
// backup root directory)/millVersion (stamped into export-everything's
// manifest) -- called once from main.go.
func New(dbPath, settingsPath, dir, millVersion string) *BackupService {
	return &BackupService{dbPath: dbPath, settingsPath: settingsPath, dir: dir, millVersion: millVersion}
}

// BackupStatus is GetBackupStatus's Wails-bound shape.
type BackupStatus struct {
	Dir          string    `json:"dir"`
	LastBackupAt time.Time `json:"lastBackupAt"`
	HasBackup    bool      `json:"hasBackup"`
	Available    bool      `json:"available"`
}

// GetBackupStatus reports the backup directory and the most recent
// snapshot's own time, read fresh off disk every call (backupDirNames'
// own listing) rather than a cached field -- BackupNow and the
// clean-shutdown hook are the only writers, and neither runs inside
// this process's request path often enough for a fresh ReadDir to
// matter.
func (b *BackupService) GetBackupStatus() (BackupStatus, error) {
	b.mu.Lock()
	dir, dbPath := b.dir, b.dbPath
	b.mu.Unlock()

	status := BackupStatus{Dir: dir, Available: dbPath != ""}
	last, err := backup.Latest(dir)
	if err != nil {
		return status, fmt.Errorf("backup status: %w", err)
	}
	if !last.IsZero() {
		status.LastBackupAt = last
		status.HasBackup = true
	}
	return status, nil
}

// BackupNow takes an immediate snapshot with the given retention
// (keepN <= 0 uses DefaultKeepN), the "Back up now" Settings button's
// own RPC. Emits dataevent's live-sync signal on success so every open
// Settings surface refreshes its "last backup" time immediately
// (docs/adr/0025).
func (b *BackupService) BackupNow(keepN int) (BackupStatus, error) {
	if keepN <= 0 {
		keepN = DefaultKeepN
	}
	b.mu.Lock()
	dbPath, settingsPath, dir := b.dbPath, b.settingsPath, b.dir
	b.mu.Unlock()

	if dbPath == "" {
		return BackupStatus{}, fmt.Errorf("backup: not available -- this instance is configured against a non-sqlite execution database")
	}
	if _, err := backup.Snapshot(dbPath, settingsPath, dir, keepN); err != nil {
		return BackupStatus{}, fmt.Errorf("backup now: %w", err)
	}
	dataevent.Emit("backup", "")
	return b.GetBackupStatus()
}

// runBackupPrimitive is the shared entry both BackupNow (via the node
// runner seam) and the shutdown hook call into -- see
// composition.SetBackupRunner's own wiring in main.go.
func (b *BackupService) runBackupPrimitive(keepN int) (string, error) {
	b.mu.Lock()
	dbPath, settingsPath, dir := b.dbPath, b.settingsPath, b.dir
	b.mu.Unlock()
	if dbPath == "" {
		return "", fmt.Errorf("backup: not available -- this instance is configured against a non-sqlite execution database")
	}
	if keepN <= 0 {
		keepN = DefaultKeepN
	}
	result, err := backup.Snapshot(dbPath, settingsPath, dir, keepN)
	if err != nil {
		return "", err
	}
	dataevent.Emit("backup", "")
	return result.Dir, nil
}

// BackupRunner returns the func composition.SetBackupRunner wires --
// //wails:ignore since this hands out a Go closure, never something a
// frontend RPC call could produce.
//
//wails:ignore
func (b *BackupService) BackupRunner() func(keepN int) (string, error) {
	return b.runBackupPrimitive
}

// BackupOnCleanShutdown runs one backup with DefaultKeepN, skipped if
// the most recent snapshot is already within SkipIfWithin -- main.go's
// own shutdown-path call (docs/goals/0065 item 4). Go-internal only,
// never a frontend RPC (there's nothing for a page already tearing
// down the app to call this for). Best-effort: an error here is
// logged by the caller, never fatal -- the app is already exiting
// either way.
//
// MANUAL-ONLY RESIDUE (.claude/rules/testing.md's registry
// discipline): this method's own logic (the skip-if-recent check, the
// primitive call) is exercised by
// TestBackupOnCleanShutdown_SkipsWithinTheHour /
// TestBackupOnCleanShutdown_RunsWhenStale below, but the REAL trigger
// -- app.Run() actually returning during a genuine window/Cmd+Q close
// -- only exists in a live desktop run, not under `go test` or
// Playwright's server-mode harness (neither ever exercises Wails3's
// own OS-level quit sequence). Verify desktop-mode: quit Mill via
// Cmd+Q shortly after a fresh install (no prior backup), confirm a new
// timestamped subdirectory appears under the backup folder before the
// process actually exits.
//
//wails:ignore
func (b *BackupService) BackupOnCleanShutdown() error {
	b.mu.Lock()
	dir := b.dir
	b.mu.Unlock()

	last, err := backup.Latest(dir)
	if err != nil {
		return fmt.Errorf("backup on shutdown: %w", err)
	}
	if !last.IsZero() && time.Since(last) < SkipIfWithin {
		return nil
	}
	_, err = b.runBackupPrimitive(DefaultKeepN)
	return err
}

// RevealBackupFolder opens the backup directory in the OS file
// manager -- reuses Wails3's own BrowserManager.OpenURL (which shells
// out to the platform's "open"/equivalent, confirmed directly against
// its darwin implementation) rather than hand-rolling an os/exec call,
// same adopt-don't-hand-roll posture .claude/rules/architecture.md
// requires. A nil application (e.g. under `go test`, no real Wails app
// running) is a no-op, matching dataevent.Emit's own defensive guard.
func (b *BackupService) RevealBackupFolder() error {
	b.mu.Lock()
	dir := b.dir
	b.mu.Unlock()

	app := application.Get()
	if app == nil {
		return nil
	}
	return app.Browser.OpenURL("file://" + dir)
}
