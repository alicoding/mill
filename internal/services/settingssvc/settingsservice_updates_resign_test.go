package settingssvc

import (
	"errors"
	"testing"
)

// swapResignBundleFn substitutes resignBundleFn for the duration of a
// test and restores it afterward -- resignBundleFn defaults to the
// real codesigning.SignBundle, which touches a real macOS keychain.
func swapResignBundleFn(t *testing.T, fake func(string) error) {
	t.Helper()
	original := resignBundleFn
	resignBundleFn = fake
	t.Cleanup(func() { resignBundleFn = original })
}

// A signer failure (most commonly: the local identity hasn't been
// granted "Always Trust" yet) must never surface as an error from the
// caller's point of view -- an update that verified and staged
// successfully must not read as failed. It sets the notice-pill
// warning instead.
func TestResignStagedBundle_SignerErrorIsNonFatal(t *testing.T) {
	set := newTestSettingsService(t)
	swapResignBundleFn(t, func(string) error { return errors.New("identity not trusted") })

	set.resignStagedBundle("/Applications/Mill.app")

	got := set.UpdateNoticeState().ResignWarning
	if got == "" {
		t.Error("ResignWarning is empty after a signer failure, want a non-fatal warning recorded")
	}
}

func TestResignStagedBundle_SignerSuccessLeavesNoWarning(t *testing.T) {
	set := newTestSettingsService(t)
	swapResignBundleFn(t, func(string) error { return nil })

	set.resignStagedBundle("/Applications/Mill.app")

	if got := set.UpdateNoticeState().ResignWarning; got != "" {
		t.Errorf("ResignWarning = %q after a successful sign, want empty", got)
	}
}

// A non-bundle path (an empty DownloadedPath, or an artifact that
// isn't a .app) must never reach the signer at all.
func TestResignStagedBundle_NonBundlePathNeverSigns(t *testing.T) {
	set := newTestSettingsService(t)
	var called bool
	swapResignBundleFn(t, func(string) error {
		called = true
		return nil
	})

	set.resignStagedBundle("")
	set.resignStagedBundle("/tmp/mill-staging/mill")

	if called {
		t.Error("resignStagedBundle called the signer for a non-.app path")
	}
}

// DownloadAndInstallUpdate must never reach the signer before it
// reaches the (real) updater's own verify+stage step -- proven here by
// the same channel/backup gates the other DownloadAndInstallUpdate
// tests already use: every one of these refusal paths returns before
// ever calling u.DownloadAndInstall, so a signer spy installed here
// must see zero calls when the flow refuses on the source-channel
// guard, exactly like it never reaches the (nil) updater either.
func TestDownloadAndInstallUpdate_RefusalPathsNeverReachTheSigner(t *testing.T) {
	set := newTestSettingsService(t)
	set.SetUpdateChannel("source")
	var called bool
	swapResignBundleFn(t, func(string) error {
		called = true
		return nil
	})

	if err := set.DownloadAndInstallUpdate(); err == nil {
		t.Fatal("DownloadAndInstallUpdate() on a source-channel build: want an error, got nil")
	}
	if called {
		t.Error("DownloadAndInstallUpdate refused on the channel guard but still called the signer")
	}
}
