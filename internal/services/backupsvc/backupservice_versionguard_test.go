package backupsvc

import (
	"testing"

	"github.com/alicoding/mill/internal/services/servicetest"
)

// TestSnapshotOnVersionChange_FreshInstall_NoBackupJustStampsVersion
// covers the "nothing to protect yet" case: no prior stamp means no
// version actually changed, so this only records the running version.
func TestSnapshotOnVersionChange_FreshInstall_NoBackupJustStampsVersion(t *testing.T) {
	store := servicetest.NewFakeStore()
	dir := t.TempDir()

	didBackup, err := SnapshotOnVersionChange(store, "", "", "", dir, "0.4.0")
	if err != nil {
		t.Fatalf("SnapshotOnVersionChange: %v", err)
	}
	if didBackup {
		t.Error("didBackup = true on a fresh install, want false (nothing to protect yet)")
	}
	if got, _ := store.Get(lastSeenVersionKey).(string); got != "0.4.0" {
		t.Errorf("stamp = %q, want %q", got, "0.4.0")
	}
}

// TestSnapshotOnVersionChange_SameVersion_NoBackup covers the
// steady-state launch: an unchanged stamp must never re-trigger a
// snapshot.
func TestSnapshotOnVersionChange_SameVersion_NoBackup(t *testing.T) {
	store := servicetest.NewFakeStore()
	if err := store.Set(lastSeenVersionKey, "0.4.0"); err != nil {
		t.Fatalf("seed stamp: %v", err)
	}
	dir := t.TempDir()

	// dbPath left empty on purpose: if this incorrectly attempted a
	// snapshot, VACUUM INTO against an empty path would error and this
	// test would fail loudly rather than silently passing either way.
	didBackup, err := SnapshotOnVersionChange(store, "", "", "", dir, "0.4.0")
	if err != nil {
		t.Fatalf("SnapshotOnVersionChange: %v", err)
	}
	if didBackup {
		t.Error("didBackup = true with an unchanged version stamp, want false")
	}
}

// TestSnapshotOnVersionChange_DifferentVersion_BackupFiresOnceThenStampUpdates
// is this guard's own acceptance criterion: a real prior stamp
// differing from the running version snapshots the real execution.db
// exactly once, then advances the stamp.
func TestSnapshotOnVersionChange_DifferentVersion_BackupFiresOnceThenStampUpdates(t *testing.T) {
	_, _, dbPath := newTestExecutionHarness(t)

	store := servicetest.NewFakeStore()
	if err := store.Set(lastSeenVersionKey, "0.3.0"); err != nil {
		t.Fatalf("seed stamp: %v", err)
	}
	dir := t.TempDir()

	didBackup, err := SnapshotOnVersionChange(store, dbPath, "", "", dir, "0.4.0")
	if err != nil {
		t.Fatalf("SnapshotOnVersionChange: %v", err)
	}
	if !didBackup {
		t.Error("didBackup = false across a real version change, want true")
	}
	if got, _ := store.Get(lastSeenVersionKey).(string); got != "0.4.0" {
		t.Errorf("stamp after snapshot = %q, want %q", got, "0.4.0")
	}

	svc := New(dbPath, "", "", dir, "test")
	status, err := svc.GetBackupStatus()
	if err != nil {
		t.Fatalf("GetBackupStatus: %v", err)
	}
	if !status.HasBackup {
		t.Error("GetBackupStatus().HasBackup = false after a version-change snapshot, want true")
	}

	// A second call at the same (now current) version must not fire
	// another snapshot -- confirms the stamp update above actually took.
	didBackup2, err := SnapshotOnVersionChange(store, dbPath, "", "", dir, "0.4.0")
	if err != nil {
		t.Fatalf("SnapshotOnVersionChange (second call): %v", err)
	}
	if didBackup2 {
		t.Error("didBackup = true on a second call at the already-stamped version, want false")
	}
}

// TestSnapshotOnVersionChange_NonSqliteDeployment_StampsWithoutError
// covers a BYO-Postgres deployment (dbPath == ""): a version change
// still can't be snapshotted (nothing for VACUUM INTO to copy), but
// the stamp must still advance so every later launch doesn't retry an
// unavailable snapshot forever.
func TestSnapshotOnVersionChange_NonSqliteDeployment_StampsWithoutError(t *testing.T) {
	store := servicetest.NewFakeStore()
	if err := store.Set(lastSeenVersionKey, "0.3.0"); err != nil {
		t.Fatalf("seed stamp: %v", err)
	}

	didBackup, err := SnapshotOnVersionChange(store, "", "", "", t.TempDir(), "0.4.0")
	if err != nil {
		t.Fatalf("SnapshotOnVersionChange: %v", err)
	}
	if didBackup {
		t.Error("didBackup = true with no dbPath (non-sqlite deployment), want false")
	}
	if got, _ := store.Get(lastSeenVersionKey).(string); got != "0.4.0" {
		t.Errorf("stamp = %q, want %q even without a snapshot", got, "0.4.0")
	}
}
