package settingssvc

import (
	"context"
	"fmt"
	"os"

	"github.com/wailsapp/wails/v3/pkg/updater"
	updaterGithub "github.com/wailsapp/wails/v3/pkg/updater/providers/github"
)

// InitUpdater constructs the GitHub Releases provider and initializes
// Wails3's own app.Updater singleton (u, already constructed by
// application.New()), then wires it into s via SetUpdater -- extracted
// from main.go's own wiring to keep that file under its line-count
// convention. AssetMatcher: the default matcher requires the literal
// GOOS in the asset name; Mill's assets say "macos", not "darwin" (see
// UpdaterAssetMatcher). ChecksumAsset: release.yml publishes
// SHA256SUMS next to the zip -- naming it makes the provider verify
// the download against it. A construction failure here would only
// happen from a malformed static Config, not a network call (New
// doesn't hit the network) -- returned for the caller to log, never
// fatal, since a broken updater must never block the app from
// starting.
func InitUpdater(u *updater.Updater, repo, currentVersion string, s *SettingsService) error {
	ghProvider, err := updaterGithub.New(updaterGithub.Config{
		Repository:    repo,
		AssetMatcher:  UpdaterAssetMatcher,
		ChecksumAsset: "SHA256SUMS",
	})
	if err != nil {
		return fmt.Errorf("updater provider init: %w", err)
	}
	if err := u.Init(updater.Config{
		CurrentVersion: currentVersion,
		Providers:      []updater.Provider{ghProvider},
	}); err != nil {
		return fmt.Errorf("updater init: %w", err)
	}
	s.SetUpdater(u)
	return nil
}

// testUpdateChannelEnv lets the Playwright e2e suite (server mode, no
// build-time ldflags available) render both channels' Updates UI
// against one binary -- same env-override seam as AtlasService's
// MILL_TEST_FOLDER_PICK_PATH.
const testUpdateChannelEnv = "MILL_TEST_UPDATE_CHANNEL"

// testUpdateFakeVersionEnv makes CheckForUpdates return a canned
// "update available" result with no network call, so e2e can render
// and interact with the available-update card without a real newer
// release existing. DownloadAndInstallUpdate honors it too, but only
// to refuse with a plain error -- fake mode never reaches the network.
const testUpdateFakeVersionEnv = "MILL_TEST_UPDATE_FAKE_VERSION"

// SetUpdater wires Wails3's own app.Updater singleton (constructed by
// application.New() itself, already Init'd by main.go with a GitHub
// Releases provider) -- set after app construction, same "wire the
// rest after construction" shape as SetWindow. docs/SPEC.md §3.7's
// research confirmed this needs no new dependency: v3/pkg/updater is
// Wails3's own first-party package.
//
//wails:ignore
func (s *SettingsService) SetUpdater(u *updater.Updater) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.updater = u
}

// UpdateCheckResult is CheckForUpdates' Wails-bound result shape.
type UpdateCheckResult struct {
	UpdateAvailable bool   `json:"updateAvailable"`
	Version         string `json:"version"`
	CurrentVersion  string `json:"currentVersion"`
	Notes           string `json:"notes"`
}

// SetAppVersion records Mill's own release version for display; wired
// from main.go's millVersion const.
//
//wails:ignore
func (s *SettingsService) SetAppVersion(v string) {
	s.mu.Lock()
	s.appVersion = v
	s.mu.Unlock()
}

// AppVersion returns Mill's own release version (empty until wired).
func (s *SettingsService) AppVersion() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.appVersion
}

// SetUpdateChannel records how this binary was distributed (main.go's
// millChannel var, itself ldflags-overridden to "release" only by
// release.yml's macOS build step). testUpdateChannelEnv wins when set,
// the same test-seam shape as AtlasService.DetectSyncRoots's
// MILL_TEST_FOLDER_PICK_PATH -- lets e2e prove both channels' Settings
// UI against one build.
//
//wails:ignore
func (s *SettingsService) SetUpdateChannel(channel string) {
	if v := os.Getenv(testUpdateChannelEnv); v != "" {
		channel = v
	}
	s.mu.Lock()
	s.updateChannel = channel
	s.mu.Unlock()
}

// UpdateChannel reports the resolved distribution channel ("source" or
// "release") -- the Settings > Updates surface's gate between "Update
// now" and the pull-and-rebuild instructions, and
// DownloadAndInstallUpdate's own server-side enforcement of the same
// gate.
func (s *SettingsService) UpdateChannel() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.updateChannel
}

// CheckForUpdates asks the configured provider (GitHub Releases,
// alicoding/mill) whether a newer version exists.
func (s *SettingsService) CheckForUpdates() (UpdateCheckResult, error) {
	if fake := os.Getenv(testUpdateFakeVersionEnv); fake != "" {
		return UpdateCheckResult{
			UpdateAvailable: true,
			Version:         fake,
			CurrentVersion:  s.AppVersion(),
			Notes:           "- Fake note one\n- Fake note two",
		}, nil
	}
	s.mu.Lock()
	u := s.updater
	s.mu.Unlock()
	if u == nil {
		return UpdateCheckResult{}, fmt.Errorf("updater not configured")
	}
	rel, err := u.Check(context.Background())
	if err != nil {
		return UpdateCheckResult{}, err
	}
	if rel == nil {
		return UpdateCheckResult{UpdateAvailable: false, CurrentVersion: s.AppVersion()}, nil
	}
	return UpdateCheckResult{UpdateAvailable: true, Version: rel.Version, CurrentVersion: s.AppVersion(), Notes: rel.Notes}, nil
}

// DownloadAndInstallUpdate downloads the newest release asset,
// verifies it against the published SHA256SUMS digest (wails/v3's own
// fail-closed verification -- a mismatch is refused, nothing
// installed), and stages it over the running app bundle.
// Channel-gated server-side, not just by the UI: a source-channel
// build must never binary-swap itself, since "source" means the
// running copy IS the update mechanism (pull + rebuild).
func (s *SettingsService) DownloadAndInstallUpdate() error {
	if s.UpdateChannel() != "release" {
		return fmt.Errorf("updates only install on the release channel -- this copy was built from source")
	}
	if fake := os.Getenv(testUpdateFakeVersionEnv); fake != "" {
		return fmt.Errorf("no release asset in test mode")
	}
	s.mu.Lock()
	u := s.updater
	s.mu.Unlock()
	if u == nil {
		return fmt.Errorf("updater not configured")
	}
	return u.DownloadAndInstall(context.Background())
}

// RestartApp relaunches into the update DownloadAndInstallUpdate just
// staged.
func (s *SettingsService) RestartApp() error {
	s.mu.Lock()
	u := s.updater
	s.mu.Unlock()
	if u == nil {
		return fmt.Errorf("updater not configured")
	}
	return u.Restart(context.Background())
}
