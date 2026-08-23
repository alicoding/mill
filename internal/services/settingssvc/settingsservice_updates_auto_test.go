package settingssvc

import (
	"errors"
	"testing"
	"time"
)

// The release channel's rare cadence needs no dwell -- a found version
// downloads on the same tick it's discovered.
func TestDecideAutoDownload_ReleaseChannelDownloadsImmediately(t *testing.T) {
	now := time.Now()
	download, candidate, since := decideAutoDownload("release", "1.2.0", "", false, "", time.Time{}, now)
	if !download {
		t.Fatal("release channel must download on first sight, want download=true")
	}
	if candidate != "" || !since.IsZero() {
		t.Errorf("release channel must not carry dwell state, got candidate=%q since=%v", candidate, since)
	}
}

// A first sighting on the beta channel starts the dwell clock rather
// than downloading immediately.
func TestDecideAutoDownload_BetaChannelFirstSightingStartsDwell(t *testing.T) {
	now := time.Now()
	download, candidate, since := decideAutoDownload("beta", "0.4.0-beta.900", "", false, "", time.Time{}, now)
	if download {
		t.Fatal("beta channel must not download on first sighting, want download=false")
	}
	if candidate != "0.4.0-beta.900" || !since.Equal(now) {
		t.Errorf("candidate = %q since = %v, want the found version starting now", candidate, since)
	}
}

// The same version, still short of the dwell window, keeps waiting.
func TestDecideAutoDownload_BetaChannelWaitsUntilDwellElapses(t *testing.T) {
	start := time.Now()
	download, candidate, since := decideAutoDownload("beta", "0.4.0-beta.900", "", false, "0.4.0-beta.900", start, start.Add(autoDownloadDwellBeta-time.Minute))
	if download {
		t.Fatal("dwell not yet elapsed, want download=false")
	}
	if candidate != "0.4.0-beta.900" || !since.Equal(start) {
		t.Errorf("candidate state changed mid-dwell: candidate=%q since=%v", candidate, since)
	}
}

// Once the SAME version has held the candidate slot for the full dwell
// window, it downloads.
func TestDecideAutoDownload_BetaChannelDownloadsAfterDwellElapses(t *testing.T) {
	start := time.Now()
	download, candidate, since := decideAutoDownload("beta", "0.4.0-beta.900", "", false, "0.4.0-beta.900", start, start.Add(autoDownloadDwellBeta))
	if !download {
		t.Fatal("dwell elapsed, want download=true")
	}
	if candidate != "" || !since.IsZero() {
		t.Errorf("dwell state must clear after a download decision, got candidate=%q since=%v", candidate, since)
	}
}

// The burst case: a newer version appearing mid-dwell resets the clock
// onto itself rather than accumulating toward the stale candidate's
// window -- this is what keeps a rapid release burst to at most one
// eventual download instead of one per intermediate version.
func TestDecideAutoDownload_NewerVersionMidDwellResetsCandidate(t *testing.T) {
	start := time.Now()
	almostDone := start.Add(autoDownloadDwellBeta - time.Second)
	download, candidate, since := decideAutoDownload("beta", "0.4.0-beta.901", "", false, "0.4.0-beta.900", start, almostDone)
	if download {
		t.Fatal("a newer version arriving mid-dwell must reset, not download immediately")
	}
	if candidate != "0.4.0-beta.901" || !since.Equal(almostDone) {
		t.Errorf("candidate = %q since = %v, want the reset onto the newer version at %v", candidate, since, almostDone)
	}
}

// A version already staged and marked ready is never re-fetched --
// this is the "skip re-fetching a version whose digest already matches
// what is staged" rule; version equality stands in for the digest
// since a published release's artifact bytes never change after
// publish, so the same version always verifies to the same digest.
func TestDecideAutoDownload_SkipsWhenAlreadyStagedAndReady(t *testing.T) {
	now := time.Now()
	for _, channel := range []string{"beta", "release"} {
		download, _, _ := decideAutoDownload(channel, "0.4.0-beta.900", "0.4.0-beta.900", true, "", time.Time{}, now)
		if download {
			t.Errorf("channel %q: already-staged same version must not re-download", channel)
		}
	}
}

// A DIFFERENT version supersedes a staged-but-not-yet-restarted one --
// staged != found means the skip guard does not apply, so the normal
// channel policy (immediate on release, dwell on beta) still runs.
func TestDecideAutoDownload_DifferentVersionThanStagedIsNotSkipped(t *testing.T) {
	now := time.Now()
	download, _, _ := decideAutoDownload("release", "0.4.1", "0.4.0", true, "", time.Time{}, now)
	if !download {
		t.Fatal("a newer version than what's staged must still download on the release channel")
	}
}

// maybeAutoDownload's own orchestration: a burst of ticks for a
// steadily-changing beta version, each arriving before the dwell
// window elapses, must never call the downloader -- proving "a burst
// of rapid beta releases produces at most one download per dwell
// window" without waiting on a real 10-minute clock.
func TestMaybeAutoDownload_RapidBetaBurstNeverDownloadsWithinDwell(t *testing.T) {
	s := newTestSettingsService(t)
	s.SetUpdateChannel("beta")
	var calls int
	download := func() error { calls++; return nil }

	start := time.Now()
	for i, version := range []string{
		"0.4.0-beta.900", "0.4.0-beta.901", "0.4.0-beta.902", "0.4.0-beta.903",
	} {
		s.maybeAutoDownload("beta", version, start.Add(time.Duration(i)*time.Minute), download)
	}
	if calls != 0 {
		t.Fatalf("downloads = %d within an unelapsed dwell window across a version burst, want 0", calls)
	}
}

// The same burst, once one version has actually held the candidate
// slot for the full dwell window, downloads exactly once.
func TestMaybeAutoDownload_DownloadsExactlyOncePerDwellWindow(t *testing.T) {
	s := newTestSettingsService(t)
	s.SetUpdateChannel("beta")
	var calls int
	download := func() error { calls++; return nil }

	start := time.Now()
	s.maybeAutoDownload("beta", "0.4.0-beta.900", start, download)
	s.maybeAutoDownload("beta", "0.4.0-beta.900", start.Add(5*time.Minute), download)
	s.maybeAutoDownload("beta", "0.4.0-beta.900", start.Add(autoDownloadDwellBeta), download)
	if calls != 1 {
		t.Fatalf("downloads = %d once the dwell window elapses on a stable version, want exactly 1", calls)
	}
	// A further tick for the identical version must not download again
	// on its own -- the caller only reaches maybeAutoDownload again once
	// stagedUpdateVersion/updateReady reflect the completed install
	// (proven by the pure decideAutoDownload skip test above); this
	// tick simulates that already-applied state directly.
	s.mu.Lock()
	s.stagedUpdateVersion = "0.4.0-beta.900"
	s.updateReady = true
	s.mu.Unlock()
	s.maybeAutoDownload("beta", "0.4.0-beta.900", start.Add(autoDownloadDwellBeta+time.Minute), download)
	if calls != 1 {
		t.Fatalf("downloads = %d after the version is already staged and ready, want still 1", calls)
	}
}

// The release channel downloads immediately, with no dwell -- one tick,
// one call.
func TestMaybeAutoDownload_ReleaseChannelDownloadsOnFirstTick(t *testing.T) {
	s := newTestSettingsService(t)
	s.SetUpdateChannel("release")
	var calls int
	download := func() error { calls++; return nil }

	s.maybeAutoDownload("release", "1.2.0", time.Now(), download)
	if calls != 1 {
		t.Fatalf("downloads = %d on the release channel's first tick, want 1", calls)
	}
}

// A downloader failure is swallowed -- background auto-download must
// never propagate an error anywhere a caller could turn it into UI
// noise (StartAutoUpdateChecks' existing posture for check failures,
// extended to download failures).
func TestMaybeAutoDownload_DownloadErrorIsSwallowed(t *testing.T) {
	s := newTestSettingsService(t)
	s.SetUpdateChannel("release")
	download := func() error { return errors.New("network unreachable") }

	s.maybeAutoDownload("release", "1.2.0", time.Now(), download)
}
