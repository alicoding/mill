package settingssvc

// The footer notice pill's server-side state (goal 0122): available/
// ready facts, per-version dismissal, the opt-in background
// check-and-download loop -- split from settingsservice_updates.go at
// the 500-line convention along the pill-vs-updater seam.

import (
	"context"
	"os"
	"strconv"
	"time"

	"github.com/alicoding/mill/internal/services/dataevent"
)

// dismissedUpdateVersionKey persists which available-update version
// the user dismissed from the notice pill (goal 0122) -- dismissal is
// per version, so the NEXT version notifies again.
const dismissedUpdateVersionKey = "dismissedUpdateVersion"

// autoUpdateCheckKey persists the opt-in background check-and-download
// loop (goal 0175: one toggle covers both, since opting into background
// checking is the same consent as opting into a background download of
// what that check found). DEFAULT OFF: the no-phone-home constraint
// reads "user-configured" strictly, so ambient checking is an explicit
// choice even on the beta channel. Applies live (goal 0207) --
// SetAutoUpdateCheck starts/stops the loop itself, no restart needed.
const autoUpdateCheckKey = "autoUpdateCheck"

// autoUpdateLoopInitialDelayDefault is how long the background loop
// waits before its very first check, whether started at boot or by a
// live toggle-on -- the gentle-timing convention (never hit the network
// the instant the app launches or the instant a preference changes).
const autoUpdateLoopInitialDelayDefault = time.Minute

// testAutoUpdateLoopDelayEnv overrides autoUpdateLoopInitialDelayDefault
// so e2e can observe a live toggle-on's first check deterministically
// instead of waiting a real minute. Ignored when unset or non-numeric.
const testAutoUpdateLoopDelayEnv = "MILL_TEST_AUTO_UPDATE_LOOP_DELAY_MS"

func autoUpdateLoopInitialDelay() time.Duration {
	if ms, err := strconv.Atoi(os.Getenv(testAutoUpdateLoopDelayEnv)); err == nil && ms >= 0 {
		return time.Duration(ms) * time.Millisecond
	}
	return autoUpdateLoopInitialDelayDefault
}

// sleepOrDone waits for d, returning true -- unless ctx is cancelled
// first, in which case it returns false immediately. The background
// loop's own interruptible sleep, so stopping it never waits out a
// pending interval.
func sleepOrDone(ctx context.Context, d time.Duration) bool {
	select {
	case <-ctx.Done():
		return false
	case <-time.After(d):
		return true
	}
}

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
	// LastCheckAt/LastCheckOutcome/LastCheckError report CheckForUpdates'
	// most recent result, whether it ran from the manual button or the
	// background loop -- Settings' own visibility into whether checking
	// is actually happening. LastCheckAt is RFC3339, "" when no check
	// has ever run. LastCheckOutcome is one of UpdateCheckOutcome's
	// values, "" meaning "never checked". LastCheckError carries the
	// failure reason and is only ever set alongside the failed outcome.
	LastCheckAt      string `json:"lastCheckAt"`
	LastCheckOutcome string `json:"lastCheckOutcome"`
	LastCheckError   string `json:"lastCheckError"`
}

// UpdateNoticeState reports what the footer pill should show.
func (s *SettingsService) UpdateNoticeState() UpdateNotice {
	if os.Getenv(testUpdateReadyEnv) != "" {
		return UpdateNotice{Ready: true}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	n := UpdateNotice{
		Ready:            s.updateReady,
		AvailableVersion: s.availableUpdate,
		Downloading:      s.updateDownloading,
		ResignWarning:    s.resignWarning,
		LastCheckOutcome: string(s.lastCheckOutcome),
		LastCheckError:   s.lastCheckError,
	}
	if !s.lastCheckAt.IsZero() {
		n.LastCheckAt = s.lastCheckAt.Format(time.RFC3339)
	}
	return n
}

// UpdateCheckOutcome distinguishes what CheckForUpdates' most recent
// run found -- reported so a check that has been failing every tick
// reads as a real, visible state rather than looking identical to "no
// update available".
type UpdateCheckOutcome string

const (
	UpdateCheckOutcomeFound    UpdateCheckOutcome = "found"
	UpdateCheckOutcomeUpToDate UpdateCheckOutcome = "upToDate"
	UpdateCheckOutcomeFailed   UpdateCheckOutcome = "failed"
)

// recordCheckOutcome is CheckForUpdates' own hook, called on every
// return path (success or failure, fake mode included) so
// UpdateNoticeState always reflects the most recent check regardless of
// which caller (the manual button or the background loop) triggered
// it. checkErr is only meaningful alongside UpdateCheckOutcomeFailed --
// every other outcome passes "".
func (s *SettingsService) recordCheckOutcome(outcome UpdateCheckOutcome, checkErr string) {
	s.mu.Lock()
	s.lastCheckAt = time.Now()
	s.lastCheckOutcome = outcome
	s.lastCheckError = checkErr
	s.mu.Unlock()
	dataevent.Emit("update-notice", "checked")
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

// SetAutoUpdateCheck persists the opt-in and applies it live (goal
// 0207): turning it on starts the background loop immediately if it
// isn't already running; turning it off stops it. Both directions are
// idempotent -- flipping the same value twice is a no-op the second
// time, never a second loop or a panic on double-stop.
func (s *SettingsService) SetAutoUpdateCheck(on bool) error {
	if err := s.store.Set(autoUpdateCheckKey, on); err != nil {
		return err
	}
	if on {
		s.startAutoUpdateLoop()
	} else {
		s.stopAutoUpdateLoop()
	}
	return nil
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

// triggerAutoDownloadPolicy is CheckForUpdates' own hook (goal 0207):
// every successful found-result -- the manual button, check-on-open, or
// the background loop's own tick -- feeds the SAME skip/supersede
// policy here, with the auto-download opt-in gating the DOWNLOAD
// decision itself rather than gating whether this hook runs at all.
// Runs in its own goroutine so a caller reading CheckForUpdates' return
// value (the manual button's RPC in particular) is never held up by an
// actual download.
func (s *SettingsService) triggerAutoDownloadPolicy(version string) {
	if !s.AutoUpdateCheck() {
		return
	}
	go s.maybeAutoDownload(version, s.DownloadAndInstallUpdate)
}

// StartAutoUpdateChecks begins the opt-in background check loop if the
// preference is already on -- called once from main.go at boot, after
// InitUpdater. A no-op when the preference is off (SetAutoUpdateCheck
// starts it live the moment it's turned on instead). Delegates to
// startAutoUpdateLoop, the same idempotent entry point the live toggle
// uses, so boot and a live opt-in behave identically.
//
//wails:ignore
func (s *SettingsService) StartAutoUpdateChecks() {
	if s.AutoUpdateCheck() {
		s.startAutoUpdateLoop()
	}
}

// startAutoUpdateLoop starts the background check loop if it isn't
// already running (idempotent -- a redundant call, e.g. a live toggle
// re-enabled right after boot's own start, never spawns a second
// loop). Each found version feeds triggerAutoDownloadPolicy through
// CheckForUpdates itself, so this loop's only job is the periodic
// check call. Check errors are ignored: a failed background check must
// never surface as noise; the manual button reports errors instead.
func (s *SettingsService) startAutoUpdateLoop() {
	s.mu.Lock()
	if s.autoUpdateLoopCancel != nil {
		s.mu.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.autoUpdateLoopCancel = cancel
	s.mu.Unlock()

	// Channel-matched cadence (goal 0146): the beta channel releases
	// per merged change, so "as soon as available" honestly means
	// hourly polling there; release stays daily.
	interval := 24 * time.Hour
	if s.UpdateChannel() == "beta" {
		interval = time.Hour
	}
	go func() {
		if !sleepOrDone(ctx, autoUpdateLoopInitialDelay()) {
			return
		}
		for {
			_, _ = s.checkForUpdates(ctx)
			if !sleepOrDone(ctx, interval) {
				return
			}
		}
	}()
}

// stopAutoUpdateLoop stops the background check loop if it's running
// (idempotent -- stopping an already-stopped loop is a no-op, never a
// panic on a nil cancel func).
func (s *SettingsService) stopAutoUpdateLoop() {
	s.mu.Lock()
	cancel := s.autoUpdateLoopCancel
	s.autoUpdateLoopCancel = nil
	s.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}
