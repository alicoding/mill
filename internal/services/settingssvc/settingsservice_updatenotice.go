package settingssvc

// The footer notice pill's server-side state (goal 0122): available/
// ready facts, per-version dismissal, the opt-in daily background
// check -- split from settingsservice_updates.go at the 500-line
// convention along the pill-vs-updater seam.

import (
	"os"
	"time"

	"github.com/alicoding/mill/internal/services/dataevent"
)

// dismissedUpdateVersionKey persists which available-update version
// the user dismissed from the notice pill (goal 0122) -- dismissal is
// per version, so the NEXT version notifies again.
const dismissedUpdateVersionKey = "dismissedUpdateVersion"

// autoUpdateCheckKey persists the opt-in daily background check.
// DEFAULT OFF: the no-phone-home constraint reads "user-configured"
// strictly, so ambient checking is an explicit choice even on the
// beta channel. Applies at boot (StartAutoUpdateChecks).
const autoUpdateCheckKey = "autoUpdateCheck"

// testUpdateReadyEnv forces the ready state so e2e can render the
// relaunch pill without a real install -- same seam family as
// testUpdateFakeVersionEnv.
const testUpdateReadyEnv = "MILL_TEST_UPDATE_READY"

// UpdateNotice is the pill's whole contract: at most one of the two
// states is meaningful, ready winning.
type UpdateNotice struct {
	Ready            bool   `json:"ready"`
	AvailableVersion string `json:"availableVersion"`
	// Downloading survives navigation (goal 0142): the phase lives
	// here, not in any component, so every surface shows the truth.
	Downloading bool `json:"downloading"`
}

// UpdateNoticeState reports what the footer pill should show.
func (s *SettingsService) UpdateNoticeState() UpdateNotice {
	if os.Getenv(testUpdateReadyEnv) != "" {
		return UpdateNotice{Ready: true}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return UpdateNotice{Ready: s.updateReady, AvailableVersion: s.availableUpdate, Downloading: s.updateDownloading}
}

// DismissUpdateNotice hides the available-update pill for the current
// version only -- the next version notifies again.
func (s *SettingsService) DismissUpdateNotice() error {
	s.mu.Lock()
	v := s.availableUpdate
	s.availableUpdate = ""
	s.mu.Unlock()
	if v == "" {
		return nil
	}
	if err := s.store.Set(dismissedUpdateVersionKey, v); err != nil {
		return err
	}
	dataevent.Emit("update-notice", v)
	return nil
}

// AutoUpdateCheck reports the persisted opt-in.
func (s *SettingsService) AutoUpdateCheck() bool {
	v, _ := s.store.Get(autoUpdateCheckKey).(bool)
	return v
}

// SetAutoUpdateCheck persists the opt-in; applies at boot.
func (s *SettingsService) SetAutoUpdateCheck(on bool) error {
	return s.store.Set(autoUpdateCheckKey, on)
}

// recordAvailableUpdate is CheckForUpdates' pill hook: remembers the
// found version unless the user dismissed exactly it, and emits the
// live-sync event so every open surface refreshes the pill.
func (s *SettingsService) recordAvailableUpdate(version string) {
	if dismissed, _ := s.store.Get(dismissedUpdateVersionKey).(string); dismissed == version {
		return
	}
	s.mu.Lock()
	s.availableUpdate = version
	s.mu.Unlock()
	dataevent.Emit("update-notice", version)
}

// markUpdateReady is DownloadAndInstallUpdate's success hook.
func (s *SettingsService) markUpdateReady() {
	s.mu.Lock()
	s.updateReady = true
	s.availableUpdate = ""
	s.mu.Unlock()
	dataevent.Emit("update-notice", "ready")
}

// StartAutoUpdateChecks begins the opt-in daily background check --
// called once from main.go after InitUpdater; a no-op when the
// preference is off. First check runs shortly after launch (the
// gentle-timing convention: near a natural moment, never mid-task),
// then daily. Errors are ignored: a failed background check must
// never surface as noise; the manual button reports errors.
//
//wails:ignore
func (s *SettingsService) StartAutoUpdateChecks() {
	if !s.AutoUpdateCheck() {
		return
	}
	go func() {
		time.Sleep(time.Minute)
		for {
			if result, err := s.CheckForUpdates(); err == nil && result.UpdateAvailable {
				s.recordAvailableUpdate(result.Version)
			}
			time.Sleep(24 * time.Hour)
		}
	}()
}
