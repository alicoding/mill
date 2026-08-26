package settingssvc

// The footer notice pill's server-side state (goal 0122): available/
// ready facts, per-version dismissal, the opt-in background
// check-and-download loop -- split from settingsservice_updates.go at
// the 500-line convention along the pill-vs-updater seam.

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"time"

	"github.com/alicoding/mill/internal/adapters/markdown"
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

// UpdateNotice is the pill's whole contract. State/StateVersion/
// StateReason (goal 0220 S1) are the ONE derived state every surface
// renders; the fields below them remain for compatibility (the
// existing pill/Settings/e2e reads) and as State's own inputs.
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
	// State is the single derived state (deriveUpdateState below) --
	// idle/checking/available/downloading/ready/error. Every surface
	// (the pill, Settings, the palette commands) renders THIS, never
	// its own reading of the fields above.
	State UpdateState `json:"state"`
	// StateVersion is the version State refers to: the pending version
	// while available/downloading, the staged version while ready, ""
	// for idle/checking/error (an error's version, if any, is still
	// reachable via AvailableVersion above).
	StateVersion string `json:"stateVersion"`
	// StateReason is populated only alongside State == error.
	StateReason string `json:"stateReason"`
	// NotesVersion/NotesHTML (goal 0220 S2) carry the release notes from
	// CheckForUpdates' most recent found result, rendered through the
	// same markdown adapter docssvc uses -- the "What's new" surface's
	// entire data source. NotesVersion can differ from StateVersion (a
	// newer check's notes arrived while an earlier download stays
	// staged-and-ready after a supersede-download failure); the version
	// header always names the version the rendered notes actually
	// belong to. Both empty until a check has ever found an update.
	NotesVersion string `json:"notesVersion"`
	NotesHTML    string `json:"notesHTML"`
}

// UpdateState is the pill/Settings/palette's single source of truth
// for "what should render right now" (goal 0220 S1) -- computed once
// by deriveUpdateState from the fields above, so two surfaces reading
// the same UpdateNotice can never disagree.
type UpdateState string

const (
	UpdateStateIdle        UpdateState = "idle"
	UpdateStateChecking    UpdateState = "checking"
	UpdateStateAvailable   UpdateState = "available"
	UpdateStateDownloading UpdateState = "downloading"
	UpdateStateReady       UpdateState = "ready"
	UpdateStateError       UpdateState = "error"
)

// deriveUpdateState is the ONE place the state machine is computed
// (goal 0220 S1) -- a pure function so every input combination is
// unit-testable without a running service.
//
// supersedes handles the "a staged update is never sacred" rule: a
// pending available version that differs from what's already staged-
// and-ready means a NEWER build exists than the one ready to restart
// into, so available/downloading wins over a stale ready -- restarting
// must always apply the newest known version, never a version behind
// one already found. A pending version equal to what's staged (a
// repeat sighting of the same release on a later check tick) is NOT a
// supersede -- ready keeps winning, matching UpdateNotice's original
// "ready wins" contract for that case.
func deriveUpdateState(checking, downloading, ready bool, availableVersion, stagedVersion, installError string, lastCheckOutcome UpdateCheckOutcome, lastCheckError string) (state UpdateState, version, reason string) {
	supersedes := availableVersion != "" && availableVersion != stagedVersion
	switch {
	case downloading:
		return UpdateStateDownloading, availableVersion, ""
	case checking:
		return UpdateStateChecking, "", ""
	case ready && !supersedes:
		return UpdateStateReady, stagedVersion, ""
	case installError != "":
		return UpdateStateError, "", installError
	case availableVersion != "":
		return UpdateStateAvailable, availableVersion, ""
	case lastCheckOutcome == UpdateCheckOutcomeFailed:
		return UpdateStateError, "", lastCheckError
	default:
		return UpdateStateIdle, "", ""
	}
}

// UpdateNoticeState reports what every update surface should show.
func (s *SettingsService) UpdateNoticeState() UpdateNotice {
	if os.Getenv(testUpdateReadyEnv) != "" {
		return UpdateNotice{Ready: true, State: UpdateStateReady}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	state, version, reason := deriveUpdateState(s.checking, s.updateDownloading, s.updateReady, s.availableUpdate, s.stagedUpdateVersion, s.lastInstallError, s.lastCheckOutcome, s.lastCheckError)
	n := UpdateNotice{
		Ready:            s.updateReady,
		AvailableVersion: s.availableUpdate,
		Downloading:      s.updateDownloading,
		ResignWarning:    s.resignWarning,
		LastCheckOutcome: string(s.lastCheckOutcome),
		LastCheckError:   s.lastCheckError,
		State:            state,
		StateVersion:     version,
		StateReason:      reason,
		NotesVersion:     s.lastNotesVersion,
	}
	if !s.lastCheckAt.IsZero() {
		n.LastCheckAt = s.lastCheckAt.Format(time.RFC3339)
	}
	// RenderHTML's only error path is the writer failing -- bytes.Buffer
	// never does, so this is unreachable in practice; a render failure
	// still degrades to an empty notes section rather than dropping the
	// whole state machine response.
	if s.lastNotesRaw != "" {
		if html, err := markdown.RenderHTML(s.lastNotesRaw); err == nil {
			n.NotesHTML = html
		}
	}
	return n
}

// recordUpdateNotes is checkForUpdates' own hook (goal 0220 S2): stores
// the release notes a found result carried, unconditionally -- unlike
// recordAvailableUpdate, dismissal never suppresses this, since
// dismissing the notice pill must never also hide "What's new" in
// Settings. The newest found result always overwrites the previous
// one, matching the state machine's own "newest known version wins"
// rule (deriveUpdateState's supersede handling).
func (s *SettingsService) recordUpdateNotes(version, notes string) {
	s.mu.Lock()
	s.lastNotesVersion = version
	s.lastNotesRaw = notes
	s.mu.Unlock()
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

// updateCheckIntervalKey persists the opt-in background loop's cadence
// (goal 0220 S1) -- replaces the old per-channel hardcoded interval
// (beta hourly / release daily) with a user-selectable preference,
// the draw.io "hourly / daily / weekly / only when I check" pattern.
const updateCheckIntervalKey = "updateCheckInterval"

const (
	UpdateCheckIntervalHourly = "hourly"
	UpdateCheckIntervalDaily  = "daily"
	UpdateCheckIntervalWeekly = "weekly"
	// UpdateCheckIntervalManual disables the background loop entirely
	// -- startAutoUpdateLoop below returns without starting it,
	// regardless of the AutoUpdateCheck opt-in.
	UpdateCheckIntervalManual = "manual"
)

// UpdateCheckInterval reports the persisted cadence, defaulting to
// hourly for every channel (the old beta-only hourly default is now
// the default everywhere).
func (s *SettingsService) UpdateCheckInterval() string {
	v, _ := s.store.Get(updateCheckIntervalKey).(string)
	switch v {
	case UpdateCheckIntervalDaily, UpdateCheckIntervalWeekly, UpdateCheckIntervalManual:
		return v
	default:
		return UpdateCheckIntervalHourly
	}
}

// SetUpdateCheckInterval persists the cadence and applies it live --
// same "apply now, no restart" posture SetAutoUpdateCheck already has.
func (s *SettingsService) SetUpdateCheckInterval(pref string) error {
	switch pref {
	case UpdateCheckIntervalHourly, UpdateCheckIntervalDaily, UpdateCheckIntervalWeekly, UpdateCheckIntervalManual:
	default:
		return fmt.Errorf("unknown update check interval %q", pref)
	}
	if err := s.store.Set(updateCheckIntervalKey, pref); err != nil {
		return err
	}
	if s.AutoUpdateCheck() {
		s.stopAutoUpdateLoop()
		s.startAutoUpdateLoop()
	}
	return nil
}

// updateCheckIntervalDuration maps the persisted preference to the
// loop's actual sleep duration -- pulled out of startAutoUpdateLoop so
// it's unit-testable without spinning up a real goroutine.
func updateCheckIntervalDuration(pref string) time.Duration {
	switch pref {
	case UpdateCheckIntervalDaily:
		return 24 * time.Hour
	case UpdateCheckIntervalWeekly:
		return 7 * 24 * time.Hour
	default:
		return time.Hour
	}
}

// startAutoUpdateLoop starts the background check loop if it isn't
// already running (idempotent -- a redundant call, e.g. a live toggle
// re-enabled right after boot's own start, never spawns a second
// loop) and the persisted interval isn't "only when I check". Each
// found version feeds triggerAutoDownloadPolicy through CheckForUpdates
// itself, so this loop's only job is the periodic check call. Check
// errors are ignored: a failed background check must never surface as
// noise; the manual button reports errors instead.
func (s *SettingsService) startAutoUpdateLoop() {
	if s.UpdateCheckInterval() == UpdateCheckIntervalManual {
		return
	}
	s.mu.Lock()
	if s.autoUpdateLoopCancel != nil {
		s.mu.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.autoUpdateLoopCancel = cancel
	s.mu.Unlock()

	interval := updateCheckIntervalDuration(s.UpdateCheckInterval())
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
