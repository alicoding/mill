package settingssvc

import (
	"errors"
	"strings"
	"testing"
)

// newTestSettingsService is defined once, in settingsservice_menu_test.go.

func TestUpdateChannel_ResolvesFromSetValue(t *testing.T) {
	set := newTestSettingsService(t)
	set.SetUpdateChannel("release")
	if got := set.UpdateChannel(); got != "release" {
		t.Errorf("UpdateChannel() = %q, want %q", got, "release")
	}
}

// Regression: main.go's millChannel defaults to "source" for every
// build except release.yml's ldflags-stamped one -- SetUpdateChannel
// must pass that value through unchanged when no test override is set.
func TestUpdateChannel_DefaultsToWhateverSetUpdateChannelIsCalledWith(t *testing.T) {
	set := newTestSettingsService(t)
	set.SetUpdateChannel("source")
	if got := set.UpdateChannel(); got != "source" {
		t.Errorf("UpdateChannel() = %q, want %q", got, "source")
	}
}

func TestUpdateChannel_TestEnvOverrideWinsOverSetValue(t *testing.T) {
	t.Setenv(testUpdateChannelEnv, "release")
	set := newTestSettingsService(t)
	set.SetUpdateChannel("source")
	if got := set.UpdateChannel(); got != "release" {
		t.Errorf("UpdateChannel() = %q, want the env override %q", got, "release")
	}
}

// DownloadAndInstallUpdate must fail closed on a source-channel build
// -- the UI never renders "Update now" there, but the guard has to
// live server-side too, since an MCP/direct-RPC caller bypasses the
// frontend entirely.
func TestDownloadAndInstallUpdate_RefusesOnSourceChannel(t *testing.T) {
	set := newTestSettingsService(t)
	set.SetUpdateChannel("source")

	err := set.DownloadAndInstallUpdate()
	if err == nil {
		t.Fatal("DownloadAndInstallUpdate() on a source-channel build: want an error, got nil")
	}
}

// A release-channel build with no configured updater (SetUpdater never
// called, same as any headless/test construction) must also refuse --
// distinct error from the channel refusal, but still no attempt at a
// nil-pointer network call. A stub backup runner isolates this test to
// the updater-nil failure specifically (see the backup-gating tests
// below for the pre-swap-snapshot failures on their own).
func TestDownloadAndInstallUpdate_RefusesWithoutConfiguredUpdater(t *testing.T) {
	set := newTestSettingsService(t)
	set.SetUpdateChannel("release")
	set.SetBackupRunner(func(int) (string, error) { return "/backups/ok", nil })

	err := set.DownloadAndInstallUpdate()
	if err == nil {
		t.Fatal("DownloadAndInstallUpdate() with no updater configured: want an error, got nil")
	}
	if !strings.Contains(err.Error(), "updater") {
		t.Errorf("DownloadAndInstallUpdate() error = %q, want it to name the missing updater (not an earlier backup failure)", err)
	}
}

// Beta installs run on real, unbacked-up-by-anyone-else data (goal
// 0100) -- DownloadAndInstallUpdate must accept the channel exactly
// like release, not just refuse it like source.
func TestDownloadAndInstallUpdate_AcceptsBetaChannel(t *testing.T) {
	set := newTestSettingsService(t)
	set.SetUpdateChannel("beta")
	set.SetBackupRunner(func(int) (string, error) { return "/backups/ok", nil })

	err := set.DownloadAndInstallUpdate()
	if err == nil || !strings.Contains(err.Error(), "updater") {
		t.Errorf("DownloadAndInstallUpdate() on beta channel = %v, want it to reach the updater-nil check (not the channel refusal)", err)
	}
}

// goal 0100's data-safety mandate: the update must never proceed
// without a fresh restore point. No backup runner configured at all
// (e.g. a headless/test construction that never wired one) aborts
// before ever reaching the updater.
func TestDownloadAndInstallUpdate_AbortsWhenNoBackupRunnerConfigured(t *testing.T) {
	set := newTestSettingsService(t)
	set.SetUpdateChannel("release")

	err := set.DownloadAndInstallUpdate()
	if err == nil {
		t.Fatal("DownloadAndInstallUpdate() with no backup runner configured: want an error, got nil")
	}
	if strings.Contains(err.Error(), "updater not configured") {
		t.Errorf("DownloadAndInstallUpdate() error = %q, want the backup-abort error, not the (later) updater-nil check", err)
	}
}

// A configured backup runner that fails must abort the update outright
// -- never swap without a restore point.
func TestDownloadAndInstallUpdate_AbortsWhenBackupFails(t *testing.T) {
	set := newTestSettingsService(t)
	set.SetUpdateChannel("release")
	set.SetBackupRunner(func(int) (string, error) { return "", errors.New("disk full") })

	err := set.DownloadAndInstallUpdate()
	if err == nil {
		t.Fatal("DownloadAndInstallUpdate() with a failing backup runner: want an error, got nil")
	}
	if !strings.Contains(err.Error(), "backup") {
		t.Errorf("DownloadAndInstallUpdate() error = %q, want it to name the aborted backup", err)
	}
	if strings.Contains(err.Error(), "updater not configured") {
		t.Errorf("DownloadAndInstallUpdate() error = %q, the updater must never be reached after a failed backup", err)
	}
}

// A successful backup must not itself block the update -- the flow
// proceeds past it to the (here, nil) updater check.
func TestDownloadAndInstallUpdate_ProceedsPastASuccessfulBackup(t *testing.T) {
	set := newTestSettingsService(t)
	set.SetUpdateChannel("release")
	var called bool
	set.SetBackupRunner(func(keepN int) (string, error) {
		called = true
		return "/backups/ok", nil
	})

	err := set.DownloadAndInstallUpdate()
	if !called {
		t.Error("DownloadAndInstallUpdate() never called the configured backup runner")
	}
	if err == nil || !strings.Contains(err.Error(), "updater") {
		t.Errorf("DownloadAndInstallUpdate() after a successful backup = %v, want it to reach the updater-nil check", err)
	}
}

// The fake-check seam short-circuits before ever touching the real
// updater -- proven by asserting it still works with s.updater left nil
// (SetUpdater was never called).
func TestCheckForUpdates_FakeVersionSeamReturnsCannedResult(t *testing.T) {
	t.Setenv(testUpdateFakeVersionEnv, "9.9.9")
	set := newTestSettingsService(t)
	set.SetAppVersion("1.0.0")

	result, err := set.CheckForUpdates()
	if err != nil {
		t.Fatalf("CheckForUpdates() with the fake-version seam set: unexpected error %v", err)
	}
	if !result.UpdateAvailable {
		t.Error("UpdateAvailable = false, want true")
	}
	if result.Version != "9.9.9" {
		t.Errorf("Version = %q, want %q", result.Version, "9.9.9")
	}
	if result.CurrentVersion != "1.0.0" {
		t.Errorf("CurrentVersion = %q, want %q", result.CurrentVersion, "1.0.0")
	}
	if result.Notes == "" {
		t.Error("Notes = \"\", want the canned fake notes")
	}
}

// In fake mode, DownloadAndInstallUpdate must never attempt a real
// network call even on a release channel -- it returns a plain error
// instead.
func TestDownloadAndInstallUpdate_FakeModeNeverHitsNetwork(t *testing.T) {
	t.Setenv(testUpdateFakeVersionEnv, "9.9.9")
	set := newTestSettingsService(t)
	set.SetUpdateChannel("release")

	err := set.DownloadAndInstallUpdate()
	if err == nil {
		t.Fatal("DownloadAndInstallUpdate() in fake mode: want an error, got nil")
	}
}

// Fake mode's own short-circuit runs before the backup-abort gate too
// -- it must never touch the backup runner, matching its "never
// reaches the network" contract.
func TestDownloadAndInstallUpdate_FakeModeNeverCallsBackupRunner(t *testing.T) {
	t.Setenv(testUpdateFakeVersionEnv, "9.9.9")
	set := newTestSettingsService(t)
	set.SetUpdateChannel("release")
	var called bool
	set.SetBackupRunner(func(int) (string, error) {
		called = true
		return "/backups/ok", nil
	})

	_ = set.DownloadAndInstallUpdate()
	if called {
		t.Error("DownloadAndInstallUpdate() in fake mode called the backup runner, want it short-circuited first")
	}
}

func TestCheckForUpdates_RefusesWithoutConfiguredUpdater(t *testing.T) {
	set := newTestSettingsService(t)
	if _, err := set.CheckForUpdates(); err == nil {
		t.Fatal("CheckForUpdates() with no updater configured: want an error, got nil")
	}
}

func TestRestartApp_RefusesWithoutConfiguredUpdater(t *testing.T) {
	set := newTestSettingsService(t)
	if err := set.RestartApp(); err == nil {
		t.Fatal("RestartApp() with no updater configured: want an error, got nil")
	}
}

func TestUpdateChannelPreference_PersistsAndValidates(t *testing.T) {
	set := newTestSettingsService(t)
	if got := set.UpdateChannelPreference(); got != "" {
		t.Errorf("UpdateChannelPreference() with nothing stored = %q, want empty", got)
	}
	if err := set.SetUpdateChannelPreference("beta"); err != nil {
		t.Fatalf("SetUpdateChannelPreference(beta): %v", err)
	}
	if got := set.UpdateChannelPreference(); got != "beta" {
		t.Errorf("UpdateChannelPreference() = %q, want beta", got)
	}
	if err := set.SetUpdateChannelPreference("nightly"); err == nil {
		t.Error("SetUpdateChannelPreference(nightly) must reject an unknown channel")
	}
	if err := set.SetUpdateChannelPreference(""); err != nil {
		t.Fatalf("SetUpdateChannelPreference(\"\") must clear the override: %v", err)
	}
	if got := set.UpdateChannelPreference(); got != "" {
		t.Errorf("UpdateChannelPreference() after clear = %q, want empty", got)
	}
}

// The opt-in a source-built copy uses to follow the beta feed: the
// persisted preference wins over the build stamp; no preference means
// the stamp passes through untouched.
func TestResolveUpdateChannel_PreferenceWinsOverBuildStamp(t *testing.T) {
	set := newTestSettingsService(t)
	if got := set.ResolveUpdateChannel("source"); got != "source" {
		t.Errorf("ResolveUpdateChannel(source) with no preference = %q, want source", got)
	}
	if err := set.SetUpdateChannelPreference("beta"); err != nil {
		t.Fatalf("SetUpdateChannelPreference: %v", err)
	}
	if got := set.ResolveUpdateChannel("source"); got != "beta" {
		t.Errorf("ResolveUpdateChannel(source) with beta preference = %q, want beta", got)
	}
}

// The install guard follows the RESOLVED channel: a source build whose
// user opted into the beta feed passes the channel gate (and then hits
// the updater-nil check in this headless test, same shape as the
// existing beta-channel case above).
func TestDownloadAndInstallUpdate_SourceBuildWithBetaPreferencePassesGate(t *testing.T) {
	set := newTestSettingsService(t)
	if err := set.SetUpdateChannelPreference("beta"); err != nil {
		t.Fatalf("SetUpdateChannelPreference: %v", err)
	}
	set.SetUpdateChannel(set.ResolveUpdateChannel("source"))
	err := set.DownloadAndInstallUpdate()
	if err == nil || strings.Contains(err.Error(), "built from source") {
		t.Errorf("DownloadAndInstallUpdate() = %v, want it past the channel refusal", err)
	}
}

// Regression, found on the first opted-in source build: SemVer puts
// every prerelease below its release, so CurrentVersion "0.4.0" on
// the beta feed always read "latest" against 0.4.0-beta.N tags.
func TestResolveUpdateCurrentVersion_FloorsSourceBuildOnBetaChannel(t *testing.T) {
	cases := []struct{ channel, in, want string }{
		{"beta", "0.4.0", "0.4.0-beta.0"},
		{"beta", "0.4.0-beta.517", "0.4.0-beta.517"},
		{"release", "0.4.0", "0.4.0"},
		{"source", "0.4.0", "0.4.0"},
	}
	for _, c := range cases {
		if got := ResolveUpdateCurrentVersion(c.channel, c.in); got != c.want {
			t.Errorf("ResolveUpdateCurrentVersion(%q, %q) = %q, want %q", c.channel, c.in, got, c.want)
		}
	}
}
