package settingssvc

// The beta-cadence auto-download policy (goal 0175): StartAutoUpdateChecks'
// per-tick decision for whether a found version should download now,
// wait, or be skipped, layered on top of the unchanged
// DownloadAndInstallUpdate chain (backup -> verify -> re-sign).

import (
	"log/slog"
	"time"
)

// autoDownloadDwellBeta is how long a beta build must be the newest
// available version before the opt-in background check downloads it.
// Mill's beta channel ships roughly per merged change, so downloading
// on first sight would fetch nearly every commit; requiring the SAME
// version to hold "newest" across this quiet period lets a burst of
// merges settle before any bytes move.
const autoDownloadDwellBeta = 10 * time.Minute

// decideAutoDownload applies the dwell/supersede/skip policy to one
// found version, independent of any timer or network call so the
// policy itself is directly testable. The release channel takes a
// newer version immediately (its cadence is rare enough that a dwell
// buys nothing); the beta channel waits for foundVersion to have been
// the candidate continuously for autoDownloadDwellBeta, resetting the
// wait whenever a DIFFERENT version is found -- so a burst of releases
// keeps deferring until one version stays newest long enough. A
// version already staged and ready is never re-fetched, since a
// published release's artifact never changes after publish.
func decideAutoDownload(channel, foundVersion, stagedVersion string, updateReady bool, candidate string, candidateSince, now time.Time) (download bool, nextCandidate string, nextCandidateSince time.Time) {
	if updateReady && stagedVersion != "" && stagedVersion == foundVersion {
		return false, candidate, candidateSince
	}
	if channel != "beta" {
		return true, "", time.Time{}
	}
	if foundVersion != candidate {
		return false, foundVersion, now
	}
	if now.Sub(candidateSince) >= autoDownloadDwellBeta {
		return true, "", time.Time{}
	}
	return false, candidate, candidateSince
}

// maybeAutoDownload is StartAutoUpdateChecks' per-tick hook. download is
// injected (defaults to s.DownloadAndInstallUpdate from the real caller)
// so the dwell/supersede/skip policy is testable with a counting stub
// instead of the real backup/network/re-sign chain, which the
// DownloadAndInstallUpdate tests already cover directly. Errors are
// swallowed -- matching StartAutoUpdateChecks' existing "a failed
// background check must never surface as noise" posture -- but logged
// so the failure isn't silent to anyone reading logs.
func (s *SettingsService) maybeAutoDownload(channel, version string, now time.Time, download func() error) {
	s.mu.Lock()
	staged := s.stagedUpdateVersion
	ready := s.updateReady
	candidate := s.autoDownloadCandidate
	candidateSince := s.autoDownloadCandidateSince
	s.mu.Unlock()

	proceed, nextCandidate, nextCandidateSince := decideAutoDownload(channel, version, staged, ready, candidate, candidateSince, now)

	s.mu.Lock()
	s.autoDownloadCandidate = nextCandidate
	s.autoDownloadCandidateSince = nextCandidateSince
	s.mu.Unlock()

	if !proceed {
		return
	}
	if err := download(); err != nil {
		slog.Warn("background auto-download failed", "version", version, "error", err)
	}
}
