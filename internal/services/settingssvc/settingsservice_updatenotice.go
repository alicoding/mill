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
	// ResignWarning carries a non-fatal re-sign failure forward (goal
	// 0158): the update installed fine, but re-signing the swapped
	// bundle with Mill's local identity failed, so Accessibility may
	// need to be re-granted after restart. Empty on every other path.
	ResignWarning string `json:"resignWarning"`
}

// UpdateNoticeState reports what the footer pill should show.
func (s *SettingsService) UpdateNoticeState() UpdateNotice {
	if os.Getenv(testUpdateReadyEnv) != "" {
		return UpdateNotice{Ready: true}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return UpdateNotice{Ready: s.updateReady, AvailableVersion: s.availableUpdate, Downloading: s.updateDownloading, ResignWarning: s.resignWarning}
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

// notifiedUpdateVersionKey remembers which version already fired the
// update-available system event (goal 0146) -- the composed
// notification fires once per version, surviving restarts, while the
// pill itself refreshes freely.
const notifiedUpdateVersionKey = "notifiedUpdateVersion"

// SetUpdateEventSink installs the composition-side listener the
// update-available system event fires through (wired from the
// composition root; nil-safe).
//
//wails:ignore
func (s *SettingsService) SetUpdateEventSink(sink func(version, channel string)) {
	s.mu.Lock()
	s.updateEventSink = sink
	s.mu.Unlock()
}

// recordAvailableUpdate is CheckForUpdates' pill hook: remembers the
// found version unless the user dismissed exactly it, emits the
// live-sync event so every open surface refreshes the pill, and --
// once per version -- fires the update-available system event so
// composed workflows (the seeded notification) can react.
func (s *SettingsService) recordAvailableUpdate(version string) {
	if dismissed, _ := s.store.Get(dismissedUpdateVersionKey).(string); dismissed == version {
		return
	}
	s.mu.Lock()
	s.availableUpdate = version
	sink := s.updateEventSink
	s.mu.Unlock()
	dataevent.Emit("update-notice", version)
	if sink == nil {
		return
	}
	if notified, _ := s.store.Get(notifiedUpdateVersionKey).(string); notified == version {
		return
	}
	_ = s.store.Set(notifiedUpdateVersionKey, version)
	sink(version, s.UpdateChannel())
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
	// Channel-matched cadence (goal 0146): the beta channel releases
	// per merged change, so "as soon as available" honestly means
	// hourly polling there; release stays daily.
	interval := 24 * time.Hour
	if s.UpdateChannel() == "beta" {
		interval = time.Hour
	}
	go func() {
		time.Sleep(time.Minute)
		for {
			if result, err := s.CheckForUpdates(); err == nil && result.UpdateAvailable {
				s.recordAvailableUpdate(result.Version)
			}
			time.Sleep(interval)
		}
	}()
}
