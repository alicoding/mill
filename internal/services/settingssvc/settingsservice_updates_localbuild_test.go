package settingssvc

// Regression coverage for goal 0403 S2d: the auto-download policy's
// own local-build guard, isLocalBuild -- an automatic download-and-
// install must never fire against a binary whose BUILD-TIME channel
// stamp marks it as a local dev/worktree/`task install:app` build,
// regardless of the user's persisted channel PREFERENCE (which can
// make the resolved UpdateChannel() report "beta" independently of
// how the binary itself was compiled).

import (
	"testing"

	"github.com/wailsapp/wails/v3/pkg/updater"
)

func TestIsLocalBuild_UnsetBuildChannelIsNotLocal(t *testing.T) {
	s := newTestSettingsService(t)
	if s.isLocalBuild() {
		t.Error("isLocalBuild() = true for an unset buildChannel, want false -- only an explicit non-release/non-beta stamp counts")
	}
}

func TestIsLocalBuild_SourceStampIsLocal(t *testing.T) {
	s := newTestSettingsService(t)
	s.SetBuildChannel("source")
	if !s.isLocalBuild() {
		t.Error("isLocalBuild() = false for buildChannel \"source\" (main.go's own default), want true")
	}
}

func TestIsLocalBuild_ReleaseAndBetaStampsAreNotLocal(t *testing.T) {
	for _, ch := range []string{"release", "beta"} {
		s := newTestSettingsService(t)
		s.SetBuildChannel(ch)
		if s.isLocalBuild() {
			t.Errorf("isLocalBuild() = true for buildChannel %q, want false", ch)
		}
	}
}

// A user's persisted channel PREFERENCE resolves into UpdateChannel()
// independently of buildChannel -- a source-stamped build opted into
// following the beta feed must still be treated as local.
func TestIsLocalBuild_UnaffectedByResolvedUpdateChannel(t *testing.T) {
	s := newTestSettingsService(t)
	s.SetBuildChannel("source")
	s.SetUpdateChannel("beta")
	if !s.isLocalBuild() {
		t.Error("isLocalBuild() = false once UpdateChannel is \"beta\" via preference, want true -- the build-time stamp must win")
	}
}

func TestSetBuildChannel_TestEnvOverrideWinsOverSetValue(t *testing.T) {
	t.Setenv(testUpdateChannelEnv, "beta")
	s := newTestSettingsService(t)
	s.SetBuildChannel("source")
	if s.isLocalBuild() {
		t.Error("isLocalBuild() = true despite MILL_TEST_UPDATE_CHANNEL=beta, want false -- the env override must win like SetUpdateChannel's own")
	}
}

// TestTriggerAutoDownloadPolicy_SkipsAutomaticApplyForALocalBuild is the
// goal 0403 S2d acceptance proof: a local build's own found-result check
// (the manual button, check-on-open, or the background loop's tick --
// CheckForUpdates feeds all three through this one hook) must never
// trigger an automatic download-and-install, even with the auto-download
// opt-in ON, so a verification pass driving a `task install:app` build
// never gets silently swapped out from under it. CheckForUpdates itself
// -- detection -- keeps answering normally; only automatic apply is
// skipped, proven here by asserting nothing ever reaches Ready. Uses the
// same real *updater.Updater chain as
// TestAutoDownloadPolicy_ChecksFeedTheDownloadChainAndCoalesceABurst,
// never a mock of DownloadAndInstallUpdate's internals.
func TestTriggerAutoDownloadPolicy_SkipsAutomaticApplyForALocalBuild(t *testing.T) {
	host := &fakeUpdaterHost{}
	body := []byte("mill-artifact-payload")
	provider := &fakeUpdaterProvider{rel: releaseFor("0.4.0-beta.900", body), body: body}

	u := updater.New(host)
	if err := u.Init(updater.Config{
		CurrentVersion: "0.4.0-beta.800",
		Providers:      []updater.Provider{provider},
	}); err != nil {
		t.Fatalf("Init: %v", err)
	}

	s := newTestSettingsService(t)
	s.SetUpdater(u)
	// The resolved channel says "beta" (the user's own preference
	// opted this source build into following the beta feed) -- the
	// build-time stamp below is what must actually gate automatic
	// apply, not this.
	s.SetUpdateChannel("beta")
	s.SetBuildChannel("source")
	s.SetBackupRunner(func(int) (string, error) { return "/backups/ok", nil })
	swapResignBundleFn(t, func(string) error { return nil })

	if err := s.SetAutoUpdateCheck(true); err != nil {
		t.Fatalf("SetAutoUpdateCheck(true): %v", err)
	}
	t.Cleanup(func() { _ = s.SetAutoUpdateCheck(false) })

	if _, err := s.CheckForUpdates(); err != nil {
		t.Fatalf("CheckForUpdates: %v", err)
	}
	// triggerAutoDownloadPolicy's local-build guard returns before ever
	// spawning maybeAutoDownload's goroutine, so nothing async is in
	// flight here -- checking immediately after CheckForUpdates returns
	// is deterministic, not a race against a skipped download.
	if got := s.UpdateNoticeState(); got.Ready {
		t.Fatal("UpdateNoticeState().Ready = true after a local build's own check, want false -- automatic apply must never run")
	}
	if got := u.DownloadedPath(); got != "" {
		t.Fatalf("DownloadedPath() = %q, want empty -- a local build must never auto-download", got)
	}

	// Detection keeps working, and a user's own explicit "Update now"
	// click still calls DownloadAndInstallUpdate directly -- unaffected
	// by this guard, which only sits in front of the automatic path.
	if err := s.DownloadAndInstallUpdate(); err != nil {
		t.Fatalf("DownloadAndInstallUpdate (manual): %v", err)
	}
	if got := s.UpdateNoticeState(); !got.Ready {
		t.Fatal("UpdateNoticeState().Ready = false after a manual DownloadAndInstallUpdate call, want true -- manual apply must stay unaffected")
	}
}
