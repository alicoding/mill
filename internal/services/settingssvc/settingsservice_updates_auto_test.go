package settingssvc

import (
	"errors"
	"testing"
)

// Removed by goal 0207's amendment: the dwell-window table tests
// (first-sighting-starts-dwell, waits-until-elapsed, downloads-after-
// elapsed, newer-version-mid-dwell-resets, and the channel-branching
// variants) along with autoDownloadDwellBeta itself. No industry
// updater dwells (Sparkle/Chrome/VS Code download what the check
// found); the dwell state machine was the hand-rolled piece that made
// this policy structurally unable to fire outside the hourly tick
// (docs/goals/0207-auto-download-never-fires.md). Replaced by the
// simpler skip-what's-staged tests below; supersede-never-stack is
// proven through the real chain in
// settingsservice_updates_autochain_test.go.

// A version never seen before downloads.
func TestDecideAutoDownload_NewVersionDownloads(t *testing.T) {
	if !decideAutoDownload("1.2.0", "", false) {
		t.Fatal("a version with nothing staged must download, want true")
	}
}

// A version already staged and marked ready is never re-fetched --
// version equality stands in for a digest match since a published
// release's artifact bytes never change after publish.
func TestDecideAutoDownload_SkipsWhenAlreadyStagedAndReady(t *testing.T) {
	if decideAutoDownload("0.4.0-beta.900", "0.4.0-beta.900", true) {
		t.Fatal("an already-staged-and-ready version must not re-download, want false")
	}
}

// A DIFFERENT version than what's staged still downloads -- staged !=
// found means the skip guard does not apply; superseding the stale
// staged build is DownloadAndInstallUpdate's own job (the adopted
// updater package's discardStaging), not this function's.
func TestDecideAutoDownload_DifferentVersionThanStagedIsNotSkipped(t *testing.T) {
	if !decideAutoDownload("0.4.1", "0.4.0", true) {
		t.Fatal("a newer version than what's staged must still download, want true")
	}
}

// A staged version that isn't marked ready yet (mid-download) is not
// treated as a skip target -- only a version that finished
// (updateReady) can be skipped.
func TestDecideAutoDownload_StagedButNotReadyStillDownloads(t *testing.T) {
	if !decideAutoDownload("0.4.0-beta.900", "0.4.0-beta.900", false) {
		t.Fatal("a staged-but-not-ready version must still allow a download decision, want true")
	}
}

// maybeAutoDownload calls the downloader when nothing is staged.
func TestMaybeAutoDownload_DownloadsWhenNothingStaged(t *testing.T) {
	s := newTestSettingsService(t)
	var calls int
	download := func() error { calls++; return nil }

	s.maybeAutoDownload("1.2.0", download)
	if calls != 1 {
		t.Fatalf("downloads = %d, want exactly 1", calls)
	}
}

// maybeAutoDownload never calls the downloader for a version already
// staged and ready.
func TestMaybeAutoDownload_SkipsWhenAlreadyStagedAndReady(t *testing.T) {
	s := newTestSettingsService(t)
	s.mu.Lock()
	s.stagedUpdateVersion = "0.4.0-beta.900"
	s.updateReady = true
	s.mu.Unlock()
	var calls int
	download := func() error { calls++; return nil }

	s.maybeAutoDownload("0.4.0-beta.900", download)
	if calls != 0 {
		t.Fatalf("downloads = %d for an already-staged-and-ready version, want 0", calls)
	}
}

// A downloader failure is swallowed -- background auto-download must
// never propagate an error anywhere a caller could turn it into UI
// noise (StartAutoUpdateChecks' existing posture for check failures,
// extended to download failures).
func TestMaybeAutoDownload_DownloadErrorIsSwallowed(t *testing.T) {
	s := newTestSettingsService(t)
	download := func() error { return errors.New("network unreachable") }

	s.maybeAutoDownload("1.2.0", download)
}
