package settingssvc

// The auto-download policy (goal 0175, simplified goal 0207): every
// successful found-result check -- manual, on-open, or the background
// loop's own tick -- feeds this one policy, layered on top of the
// unchanged DownloadAndInstallUpdate chain (backup -> verify -> re-sign).
// No dwell/candidate state: the adopted updater package's own
// skip-what's-staged and supersede-never-stack behavior already coalesce
// a burst of sequential releases to one staged build, so a hand-rolled
// quiet-period timer added nothing but the state machine that made this
// policy structurally unable to fire from anywhere but the hourly tick
// (goal 0207's finding).

import (
	"log/slog"
)

// decideAutoDownload applies the skip-what's-staged rule to one found
// version: a version identical to what's already staged and marked
// ready is never re-fetched, since a published release's artifact never
// changes after publish (version equality stands in for a digest
// match). Every other found version proceeds to download -- superseding
// a stale staged-but-unrestarted build happens inside
// DownloadAndInstallUpdate's own chain (the adopted updater package's
// discardStaging), never duplicated here.
func decideAutoDownload(foundVersion, stagedVersion string, updateReady bool) bool {
	if updateReady && stagedVersion != "" && stagedVersion == foundVersion {
		return false
	}
	return true
}

// maybeAutoDownload is the auto-download opt-in's own gate, called from
// every successful found-result check
// (settingsservice_updatenotice.go's triggerAutoDownloadPolicy).
// download is injected (defaults to s.DownloadAndInstallUpdate from the
// real caller) so the skip policy is testable with a counting stub
// instead of the real backup/network/re-sign chain, which the
// DownloadAndInstallUpdate tests already cover directly. Errors are
// swallowed -- matching StartAutoUpdateChecks' existing "a failed
// background check must never surface as noise" posture -- but logged
// so the failure isn't silent to anyone reading logs.
func (s *SettingsService) maybeAutoDownload(version string, download func() error) {
	s.mu.Lock()
	staged := s.stagedUpdateVersion
	ready := s.updateReady
	s.mu.Unlock()

	if !decideAutoDownload(version, staged, ready) {
		return
	}
	if err := download(); err != nil {
		slog.Warn("background auto-download failed", "version", version, "error", err)
	}
}
