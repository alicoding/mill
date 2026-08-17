package settingssvc

import (
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
// nil-pointer network call.
func TestDownloadAndInstallUpdate_RefusesWithoutConfiguredUpdater(t *testing.T) {
	set := newTestSettingsService(t)
	set.SetUpdateChannel("release")

	err := set.DownloadAndInstallUpdate()
	if err == nil {
		t.Fatal("DownloadAndInstallUpdate() with no updater configured: want an error, got nil")
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
