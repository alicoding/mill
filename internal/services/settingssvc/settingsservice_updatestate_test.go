package settingssvc

// The one derived update state machine's own coverage (goal 0220 S1) --
// split from settingsservice_updatenotice_test.go at the 500-line
// convention (architecture.md).

import (
	"testing"
	"time"

	"github.com/wailsapp/wails/v3/pkg/updater"
)

// TestDeriveUpdateState covers every reachable field combination --
// each must resolve to exactly one state, matching UpdateNotice's own
// "every surface renders THIS" contract.
func TestDeriveUpdateState(t *testing.T) {
	cases := []struct {
		name             string
		checking         bool
		downloading      bool
		ready            bool
		availableVersion string
		stagedVersion    string
		installError     string
		lastCheckOutcome UpdateCheckOutcome
		lastCheckError   string
		wantState        UpdateState
		wantVersion      string
		wantReason       string
	}{
		{
			name:      "never checked",
			wantState: UpdateStateIdle,
		},
		{
			name:      "checking",
			checking:  true,
			wantState: UpdateStateChecking,
		},
		{
			name:             "a fresh version is available",
			availableVersion: "0.5.0",
			wantState:        UpdateStateAvailable,
			wantVersion:      "0.5.0",
		},
		{
			name:             "downloading the available version",
			downloading:      true,
			availableVersion: "0.5.0",
			wantState:        UpdateStateDownloading,
			wantVersion:      "0.5.0",
		},
		{
			name:          "ready with nothing newer pending",
			ready:         true,
			stagedVersion: "0.5.0",
			wantState:     UpdateStateReady,
			wantVersion:   "0.5.0",
		},
		{
			name:             "a repeat sighting of the already-staged version stays ready",
			ready:            true,
			availableVersion: "0.5.0",
			stagedVersion:    "0.5.0",
			wantState:        UpdateStateReady,
			wantVersion:      "0.5.0",
		},
		{
			name:             "a staged update is never sacred: a newer sighting supersedes a stale ready",
			ready:            true,
			availableVersion: "0.6.0",
			stagedVersion:    "0.5.0",
			wantState:        UpdateStateAvailable,
			wantVersion:      "0.6.0",
		},
		{
			name:             "downloading the supersede wins over the stale ready",
			downloading:      true,
			ready:            true,
			availableVersion: "0.6.0",
			stagedVersion:    "0.5.0",
			wantState:        UpdateStateDownloading,
			wantVersion:      "0.6.0",
		},
		{
			// failInstall never clears the pending version on failure
			// (settingsservice_updates.go) -- a destructive supersede
			// failure clears Ready/staged (the prior build is
			// genuinely gone, discardStaging already ran) but leaves
			// the newer version on offer as an immediate retry,
			// rather than dead-ending on a bare error the user must
			// re-trigger manually. The failure itself still surfaces
			// via LastCheckOutcome/LastCheckError (proven at the
			// UpdateNoticeState integration level below), which
			// State's own contract keeps separate from this value.
			name:             "a destructive failed supersede offers the newer version as a retry, never a false ready",
			ready:            false,
			availableVersion: "0.6.0",
			stagedVersion:    "",
			lastCheckOutcome: UpdateCheckOutcomeFailed,
			lastCheckError:   "a newer update couldn't download: digest mismatch",
			wantState:        UpdateStateAvailable,
			wantVersion:      "0.6.0",
		},
		{
			// A NON-destructive failure (e.g. the backup step, which
			// runs before the real updater's own DownloadAndInstall
			// and its discardStaging) never touches the prior ready
			// build -- but a newer version is still known and pending,
			// so it still wins as the actionable state (supersedes),
			// same "push toward the newest" rule as the success case.
			// Dismissing that pending version (DismissUpdateNotice)
			// is what re-reveals the still-genuinely-valid ready(vX)
			// underneath -- covered by the "nothing newer pending"
			// case above.
			name:             "a non-destructive failed supersede still offers the newer version, not the still-valid stale ready",
			ready:            true,
			availableVersion: "0.6.0",
			stagedVersion:    "0.5.0",
			lastCheckOutcome: UpdateCheckOutcomeFailed,
			lastCheckError:   "a newer update couldn't download: backup failed",
			wantState:        UpdateStateAvailable,
			wantVersion:      "0.6.0",
		},
		{
			name:             "a non-supersede install failure is its own error state",
			installError:     "digest mismatch",
			availableVersion: "0.5.0",
			wantState:        UpdateStateError,
			wantReason:       "digest mismatch",
		},
		{
			name:             "a failed check with nothing ever found",
			lastCheckOutcome: UpdateCheckOutcomeFailed,
			lastCheckError:   "network unreachable",
			wantState:        UpdateStateError,
			wantReason:       "network unreachable",
		},
		{
			name:             "a successful up-to-date check is idle",
			lastCheckOutcome: UpdateCheckOutcomeUpToDate,
			wantState:        UpdateStateIdle,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			state, version, reason := deriveUpdateState(tc.checking, tc.downloading, tc.ready, tc.availableVersion, tc.stagedVersion, tc.installError, tc.lastCheckOutcome, tc.lastCheckError)
			if state != tc.wantState {
				t.Errorf("state = %q, want %q", state, tc.wantState)
			}
			if version != tc.wantVersion {
				t.Errorf("version = %q, want %q", version, tc.wantVersion)
			}
			if reason != tc.wantReason {
				t.Errorf("reason = %q, want %q", reason, tc.wantReason)
			}
		})
	}
}

func TestUpdateCheckInterval_DefaultsHourlyAndPersists(t *testing.T) {
	s := newTestSettingsService(t)
	if got := s.UpdateCheckInterval(); got != UpdateCheckIntervalHourly {
		t.Errorf("default UpdateCheckInterval() = %q, want %q", got, UpdateCheckIntervalHourly)
	}

	if err := s.SetUpdateCheckInterval(UpdateCheckIntervalWeekly); err != nil {
		t.Fatal(err)
	}
	if got := s.UpdateCheckInterval(); got != UpdateCheckIntervalWeekly {
		t.Errorf("UpdateCheckInterval() after Set = %q, want %q", got, UpdateCheckIntervalWeekly)
	}

	if err := s.SetUpdateCheckInterval("fortnightly"); err == nil {
		t.Error("SetUpdateCheckInterval with an unknown value: want an error, got nil")
	}
}

func TestUpdateCheckIntervalDuration_MapsEveryPreference(t *testing.T) {
	cases := map[string]time.Duration{
		UpdateCheckIntervalHourly: time.Hour,
		UpdateCheckIntervalDaily:  24 * time.Hour,
		UpdateCheckIntervalWeekly: 7 * 24 * time.Hour,
		"":                        time.Hour, // unset falls back to hourly
	}
	for pref, want := range cases {
		if got := updateCheckIntervalDuration(pref); got != want {
			t.Errorf("updateCheckIntervalDuration(%q) = %v, want %v", pref, got, want)
		}
	}
}

// "Only when I check" must disable the background loop even when the
// opt-in checkbox is on -- startAutoUpdateLoop's own manual-interval
// guard, not a second toggle.
func TestUpdateCheckIntervalManual_DisablesTheLoopEvenWhenOptedIn(t *testing.T) {
	s := newTestSettingsService(t)
	if err := s.SetUpdateCheckInterval(UpdateCheckIntervalManual); err != nil {
		t.Fatal(err)
	}
	if err := s.SetAutoUpdateCheck(true); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.SetAutoUpdateCheck(false) })

	s.mu.Lock()
	running := s.autoUpdateLoopCancel != nil
	s.mu.Unlock()
	if running {
		t.Fatal("the loop started despite the interval being set to manual")
	}
}

// Switching the interval live restarts an already-running loop, same
// "apply now, no restart" posture as SetAutoUpdateCheck.
func TestSetUpdateCheckInterval_ManualStopsAnAlreadyRunningLoopLive(t *testing.T) {
	s := newTestSettingsService(t)
	if err := s.SetAutoUpdateCheck(true); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.SetAutoUpdateCheck(false) })

	s.mu.Lock()
	running := s.autoUpdateLoopCancel != nil
	s.mu.Unlock()
	if !running {
		t.Fatal("setup: the loop must be running before switching to manual")
	}

	if err := s.SetUpdateCheckInterval(UpdateCheckIntervalManual); err != nil {
		t.Fatal(err)
	}
	s.mu.Lock()
	running = s.autoUpdateLoopCancel != nil
	s.mu.Unlock()
	if running {
		t.Fatal("switching the interval to manual left the loop running")
	}
}

// TestDownloadAndInstallUpdate_FailedSupersedeSurfacesCheckErrorAndClearsReadiness
// is the integration proof for goal 0220 S1's "a staged update is
// never sacred" rule's failure branch, against the REAL adopted
// updater (not a hand-rolled stand-in) -- confirms the traced finding:
// wails/v3 pkg/updater's DownloadAndInstall calls discardStaging()
// unconditionally as its first action, before the new download even
// starts, so a failed supersede attempt has already destroyed the
// previously-ready build regardless of outcome. Mill's own bookkeeping
// must follow that reality (Ready clears, Restart would otherwise fail
// with no explanation) rather than keep claiming a build that's gone.
func TestDownloadAndInstallUpdate_FailedSupersedeSurfacesCheckErrorAndClearsReadiness(t *testing.T) {
	host := &fakeUpdaterHost{}
	body1 := []byte("mill-artifact-v1-payload")
	provider := &fakeUpdaterProvider{rel: releaseFor("0.4.0-beta.900", body1), body: body1}

	u := updater.New(host)
	if err := u.Init(updater.Config{
		CurrentVersion: "0.4.0-beta.800",
		Providers:      []updater.Provider{provider},
	}); err != nil {
		t.Fatalf("Init: %v", err)
	}

	s := newTestSettingsService(t)
	s.SetUpdater(u)
	s.SetUpdateChannel("beta")
	s.SetBackupRunner(func(int) (string, error) { return "/backups/ok", nil })
	swapResignBundleFn(t, func(string) error { return nil })

	// First install succeeds and reaches ready(0.4.0-beta.900).
	if _, err := s.CheckForUpdates(); err != nil {
		t.Fatalf("first CheckForUpdates: %v", err)
	}
	if err := s.DownloadAndInstallUpdate(); err != nil {
		t.Fatalf("first DownloadAndInstallUpdate: %v", err)
	}
	if n := s.UpdateNoticeState(); n.State != UpdateStateReady || n.StateVersion != "0.4.0-beta.900" {
		t.Fatalf("after the first install: state = %+v, want ready(0.4.0-beta.900)", n)
	}

	// A newer release appears with a corrupted digest -- the supersede
	// attempt must fail closed. Mid-flight (found, not yet attempted),
	// the state must already show the supersede as available, never
	// the stale ready.
	rel2 := releaseFor("0.4.0-beta.905", []byte("expected-bytes"))
	rel2.Verification.Digest[0] ^= 0xFF
	provider.rel = rel2
	provider.body = []byte("expected-bytes")

	if _, err := s.CheckForUpdates(); err != nil {
		t.Fatalf("second CheckForUpdates: %v", err)
	}
	if n := s.UpdateNoticeState(); n.State != UpdateStateAvailable || n.StateVersion != "0.4.0-beta.905" {
		t.Fatalf("mid-supersede: state = %+v, want available(0.4.0-beta.905)", n)
	}

	if err := s.DownloadAndInstallUpdate(); err == nil {
		t.Fatal("supersede download with a corrupted digest: want an error, got nil")
	}

	n := s.UpdateNoticeState()
	if n.Ready {
		t.Errorf("Ready = true after a failed supersede, want false -- the prior staged build is genuinely gone (discardStaging already ran)")
	}
	if s.stagedUpdateVersion != "" {
		t.Errorf("stagedUpdateVersion = %q after a failed supersede, want cleared", s.stagedUpdateVersion)
	}
	if n.LastCheckOutcome != string(UpdateCheckOutcomeFailed) {
		t.Errorf("LastCheckOutcome = %q, want %q -- a failed supersede surfaces via the check-error line", n.LastCheckOutcome, UpdateCheckOutcomeFailed)
	}
	if n.LastCheckError == "" {
		t.Error("LastCheckError is empty, want the supersede failure reason")
	}
}
