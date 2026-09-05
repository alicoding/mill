package backupsvc

import (
	"fmt"
	"log/slog"

	"github.com/alicoding/mill/internal/adapters/backup"
	"github.com/alicoding/mill/internal/adapters/settings"
)

// lastSeenVersionKey persists the version stamp SnapshotOnVersionChange
// compares against on every launch -- a settings.Store key, so it lives
// beside settings.json (the same directory backup.Snapshot also copies
// into every snapshot), not inside execution.db itself: a downgraded
// relaunch (an older binary) must still be able to read this key with
// its own, older settings.Store implementation, which a value stored
// only inside the newer schema's execution.db could not guarantee.
const lastSeenVersionKey = "settings-last-seen-version"

// SnapshotOnVersionChange is goal 0100's belt-and-suspenders data-safety
// guard: called once from main.go, before any other service opens or
// migrates execution.db, on every launch regardless of channel --
// covers both an in-app update (which DownloadAndInstallUpdate's own
// pre-swap backup already snapshots, so this is redundant-but-cheap
// there) and the source-channel pull+rebuild path, where no updater
// ever runs and this is the ONLY snapshot guard.
//
// A missing stamp (first launch ever against this data directory) is
// not a version change -- nothing to protect yet -- so it only records
// the current version. An unchanged stamp is a no-op. A changed stamp
// (upgrade or downgrade) snapshots first and only then advances the
// stamp, so a snapshot that fails leaves the stamp untouched and the
// next launch retries it rather than silently skipping forever.
//
// dbPath == "" (a BYO-Postgres deployment, docs/goals/0065 item 6) has
// nothing for VACUUM INTO to copy; the version stamp still advances so
// a non-sqlite deployment isn't stuck re-attempting an unavailable
// snapshot on every single launch.
func SnapshotOnVersionChange(store settings.Store, dbPath, settingsPath, vaultPath, dir, currentVersion string) (didBackup bool, err error) {
	stamp, _ := store.Get(lastSeenVersionKey).(string)
	if stamp == currentVersion {
		return false, nil
	}
	if stamp != "" && dbPath != "" {
		if _, err := backup.Snapshot(dbPath, settingsPath, vaultPath, dir, DefaultKeepN); err != nil {
			return false, fmt.Errorf("version-change snapshot (%s -> %s): %w", stamp, currentVersion, err)
		}
		didBackup = true
	}
	if err := store.Set(lastSeenVersionKey, currentVersion); err != nil {
		return didBackup, fmt.Errorf("persist version stamp after snapshot: %w", err)
	}
	return didBackup, nil
}

// GuardVersionChange wraps SnapshotOnVersionChange with main.go's own
// logging, extracted so main.go's wiring stays terse (the same
// keep-main.go-under-its-line-count reasoning InitUpdater's own
// extraction already documents). Best-effort, matching
// BackupOnCleanShutdown's own non-fatal posture: a failed snapshot
// here is logged, never fatal -- it must never make Mill unbootable.
func GuardVersionChange(logger *slog.Logger, store settings.Store, dbPath, settingsPath, vaultPath, dir, currentVersion string) {
	didBackup, err := SnapshotOnVersionChange(store, dbPath, settingsPath, vaultPath, dir, currentVersion)
	if err != nil {
		logger.Error("version-change snapshot", "error", err)
		return
	}
	if didBackup {
		logger.Info("version-change snapshot taken", "version", currentVersion)
	}
}
