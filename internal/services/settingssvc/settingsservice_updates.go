package settingssvc

import (
	"context"
	"fmt"
	"github.com/alicoding/mill/internal/services/dataevent"
	"net/http"
	"net/url"
	"os"
	"runtime"
	"strings"
	"time"

	gproxy "github.com/rapid7/go-get-proxied/proxy"
	"github.com/wailsapp/wails/v3/pkg/updater"
	updaterGithub "github.com/wailsapp/wails/v3/pkg/updater/providers/github"
)

// updaterUserAgentTransport stamps a descriptive User-Agent on every
// updater request. The provider's default client sends Go's anonymous
// "Go-http-client", which managed-network proxies commonly filter;
// identifying as Mill's own updater names the traffic honestly in
// proxy logs either way. Clones the request per the RoundTripper
// contract (a RoundTrip must not mutate its argument).
type updaterUserAgentTransport struct {
	agent string
	base  http.RoundTripper
}

func (t updaterUserAgentTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	clone := req.Clone(req.Context())
	clone.Header.Set("User-Agent", t.agent)
	return t.base.RoundTrip(clone)
}

func newUpdaterHTTPClient(currentVersion, proxyURL string) *http.Client {
	// A dedicated transport, not http.DefaultTransport: the proxy
	// choice (goal 0123) must not mutate the process-wide default.
	base := http.DefaultTransport.(*http.Transport).Clone()
	base.Proxy = updaterProxyFunc(proxyURL)
	return &http.Client{
		Timeout: 30 * time.Second,
		Transport: updaterUserAgentTransport{
			agent: "Mill-Updater/" + currentVersion,
			base:  base,
		},
	}
}

// InitUpdater constructs the GitHub Releases provider and initializes
// Wails3's own app.Updater singleton (u, already constructed by
// application.New()), then wires it into s via SetUpdater -- extracted
// from main.go's own wiring to keep that file under its line-count
// convention. AssetMatcher: the default matcher requires the literal
// GOOS in the asset name; Mill's assets say "macos", not "darwin" (see
// UpdaterAssetMatcher). ChecksumAsset: release.yml publishes
// SHA256SUMS next to the zip -- naming it makes the provider verify
// the download against it. Prerelease is set only for channel=="beta":
// the GitHub provider's Check walks /releases/latest (excludes
// prereleases) unless Prerelease is true, in which case it walks
// /releases and returns the newest published non-draft entry --
// exactly the "update to a newer beta OR a newer real release,
// whichever shipped last" behavior goal 0100 wants, with zero extra
// code (confirmed directly against the vendored provider source). A
// release-channel build's Prerelease stays false, so it can never see
// the beta feed -- unaffected, byte-identical to before. A
// construction failure here would only happen from a malformed static
// Config, not a network call (New doesn't hit the network) -- returned
// for the caller to log, never fatal, since a broken updater must
// never block the app from starting.
func InitUpdater(u *updater.Updater, repo, currentVersion, channel string, s *SettingsService) error {
	ghProvider, err := updaterGithub.New(updaterGithub.Config{
		Repository:    repo,
		AssetMatcher:  UpdaterAssetMatcher,
		ChecksumAsset: "SHA256SUMS",
		Prerelease:    channel == "beta",
		HTTPClient:    newUpdaterHTTPClient(currentVersion, s.OutboundProxyURL()),
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

// SetBackupRunner wires the pre-update-snapshot seam
// DownloadAndInstallUpdate calls before any bundle swap (goal 0100's
// data-safety mandate) -- set from main.go via
// backupService.BackupRunner(), the exact same injected-closure shape
// composition.SetBackupRunner already uses for apply-backup-snapshot
// nodes.
//
//wails:ignore
func (s *SettingsService) SetBackupRunner(fn func(keepN int) (string, error)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.backupRunner = fn
}

// UpdateCheckResult is CheckForUpdates' Wails-bound result shape.
type UpdateCheckResult struct {
	UpdateAvailable bool   `json:"updateAvailable"`
	Version         string `json:"version"`
	CurrentVersion  string `json:"currentVersion"`
	Notes           string `json:"notes"`
}

// SetAppVersion records Mill's own running version for display; wired
// from main.go's millUpdateVersion (millVersion for release/source,
// a per-build beta identifier for the beta channel).
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

// UpdateChannel reports the resolved distribution channel ("source",
// "release", or "beta") -- the Settings > Updates surface's gate
// between "Update now" and the pull-and-rebuild instructions, and
// DownloadAndInstallUpdate's own server-side enforcement of the same
// gate.
func (s *SettingsService) UpdateChannel() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.updateChannel
}

// outboundProxyKey persists the app-level outbound proxy URL (goal
// 0123, the multi-purpose-surface rule's network instance): first
// consumer is the updater's HTTP client -- a managed network that
// 403s direct non-browser downloads allows the same fetch through
// its proxy. Empty = Go's ProxyFromEnvironment (env vars keep
// working for server-mode/CLI launches; a Finder-launched app has
// none, which is exactly why this preference exists). Applies at
// boot, same restart semantics as the channel preference.
const outboundProxyKey = "outboundProxyURL"

// OutboundProxyURL returns the persisted proxy URL ("" = none).
func (s *SettingsService) OutboundProxyURL() string {
	v, _ := s.store.Get(outboundProxyKey).(string)
	return v
}

// SetOutboundProxyURL validates and persists the proxy URL; "" clears.
func (s *SettingsService) SetOutboundProxyURL(raw string) error {
	raw = strings.TrimSpace(raw)
	if raw != "" && raw != proxyModeOff {
		u, err := url.Parse(raw)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			return fmt.Errorf("the proxy must be an http or https URL, like http://proxy.example.com:8080")
		}
	}
	return s.store.Set(outboundProxyKey, raw)
}

// proxyModeOff is the persisted sentinel for "always connect
// directly" -- distinct from "" (Auto), which detects the system
// proxy. Stored in the same key as a manual URL; never a valid URL.
const proxyModeOff = "off"

// updaterProxyFunc picks the transport proxy by mode (goal 0123):
// a manual URL always wins; "off" forces direct; "" (Auto, the
// default) asks the OS for its configured proxy per request via
// go-get-proxied (macOS scutil/env; PAC-only setups aren't resolved
// -- the named gap -- and fall through to environment resolution).
func updaterProxyFunc(pref string) func(*http.Request) (*url.URL, error) {
	switch pref {
	case proxyModeOff:
		return func(*http.Request) (*url.URL, error) { return nil, nil }
	case "":
		provider := gproxy.NewProvider("")
		return func(req *http.Request) (*url.URL, error) {
			if p := provider.GetProxy(req.URL.Scheme, req.URL.String()); p != nil {
				return p.URL(), nil
			}
			return http.ProxyFromEnvironment(req)
		}
	}
	fixed, err := url.Parse(pref)
	if err != nil {
		return http.ProxyFromEnvironment
	}
	return http.ProxyURL(fixed)
}

// updateChannelPreferenceKey persists the user's channel opt-in. A
// source-built copy following the beta feed is a deliberate, explicit
// choice (docs/goals/archive/0100-beta-channel.md's follow-up slice)
// -- source-never-installs survives as the DEFAULT, not a wall.
const updateChannelPreferenceKey = "updateChannelPreference"

// UpdateChannelPreference returns the persisted channel override:
// "" (follow the build's own channel), "beta", or "release".
func (s *SettingsService) UpdateChannelPreference() string {
	v, _ := s.store.Get(updateChannelPreferenceKey).(string)
	if v != "beta" && v != "release" {
		return ""
	}
	return v
}

// SetUpdateChannelPreference persists the channel override. The
// preference resolves at BOOT (ResolveUpdateChannel below): the update
// provider's feed selection is fixed at Init, so a change applies
// after the next restart -- the UI says so rather than pretending a
// live switch happened.
func (s *SettingsService) SetUpdateChannelPreference(pref string) error {
	if pref != "" && pref != "beta" && pref != "release" {
		return fmt.Errorf("unknown update channel %q", pref)
	}
	return s.store.Set(updateChannelPreferenceKey, pref)
}

// ResolveUpdateChannel returns the effective channel for this run: the
// persisted preference when set, else the build's ldflags stamp.
// main.go calls this once before SetUpdateChannel/InitUpdater so the
// guard, the UI label, and the provider's feed all agree.
func (s *SettingsService) ResolveUpdateChannel(buildChannel string) string {
	if pref := s.UpdateChannelPreference(); pref != "" {
		return pref
	}
	return buildChannel
}

// ResolveUpdateCurrentVersion returns what the updater should compare
// the feed against. A source build stamps the bare release version
// ("0.4.0"), and SemVer puts every prerelease BELOW its release --
// so a source build opted into the beta channel could never see any
// 0.4.0-beta.N as newer and always read "latest". When the
// effective channel is beta and the
// stamped version carries no prerelease, floor it at "-beta.0": every
// real beta.N then registers as newer, and a future plain release
// still wins over any beta. Every other combination passes through
// untouched.
func ResolveUpdateCurrentVersion(effectiveChannel, updateVersion string) string {
	if effectiveChannel == "beta" && !strings.Contains(updateVersion, "-") {
		return updateVersion + "-beta.0"
	}
	return updateVersion
}

// CheckForUpdates asks the configured provider (GitHub Releases,
// alicoding/mill) whether a newer version exists.
func (s *SettingsService) CheckForUpdates() (UpdateCheckResult, error) {
	if fake := os.Getenv(testUpdateFakeVersionEnv); fake != "" {
		s.recordAvailableUpdate(fake)
		s.recordCheckOutcome(UpdateCheckOutcomeFound, "")
		return UpdateCheckResult{
			UpdateAvailable: true,
			Version:         fake,
			CurrentVersion:  s.AppVersion(),
			// Carries the marker + below-the-fold text so e2e proves the
			// trim through the real render path.
			Notes: trimReleaseNotesForApp("## What's new\n\n- Fake note one\n- Fake note two\n\n" + inAppNotesEndMarker + "\n## Manual install\nxattr slop that must never render in-app"),
		}, nil
	}
	s.mu.Lock()
	u := s.updater
	s.mu.Unlock()
	if u == nil {
		err := fmt.Errorf("updater not configured")
		s.recordCheckOutcome(UpdateCheckOutcomeFailed, err.Error())
		return UpdateCheckResult{}, err
	}
	rel, err := u.Check(context.Background())
	if err != nil {
		sanitized := sanitizeUpdaterError(err)
		s.recordCheckOutcome(UpdateCheckOutcomeFailed, sanitized.Error())
		return UpdateCheckResult{}, sanitized
	}
	if rel == nil {
		s.recordCheckOutcome(UpdateCheckOutcomeUpToDate, "")
		return UpdateCheckResult{UpdateAvailable: false, CurrentVersion: s.AppVersion()}, nil
	}
	s.recordAvailableUpdate(rel.Version)
	s.recordCheckOutcome(UpdateCheckOutcomeFound, "")
	return UpdateCheckResult{UpdateAvailable: true, Version: rel.Version, CurrentVersion: s.AppVersion(), Notes: trimReleaseNotesForApp(rel.Notes)}, nil
}

// DownloadAndInstallUpdate downloads the newest release asset,
// verifies it against the published SHA256SUMS digest (wails/v3's own
// fail-closed verification -- a mismatch is refused, nothing
// installed), and stages it over the running app bundle.
// Channel-gated server-side, not just by the UI: a source-channel
// build must never binary-swap itself, since "source" means the
// running copy IS the update mechanism (pull + rebuild).
//
// goal 0100: a beta install swaps its running app over real, primary
// data, so the swap never proceeds without a fresh restore point. The
// backupRunner seam is called first and its error aborts the update
// outright -- no download, no swap -- same fail-closed posture as the
// digest check below it.
func (s *SettingsService) DownloadAndInstallUpdate() error {
	s.mu.Lock()
	if s.updateDownloading {
		s.mu.Unlock()
		return fmt.Errorf("the update is already downloading -- the Relaunch button appears when it's ready")
	}
	s.updateDownloading = true
	s.resignWarning = ""
	// Captured now, before any later CheckForUpdates tick can overwrite
	// availableUpdate mid-flight -- this is the version this specific
	// call is staging, recorded on success so a repeat sighting of the
	// same version (goal 0175's auto-download policy) can skip it.
	version := s.availableUpdate
	s.mu.Unlock()
	dataevent.Emit("update-notice", "downloading")
	defer func() {
		s.mu.Lock()
		s.updateDownloading = false
		s.mu.Unlock()
		dataevent.Emit("update-notice", "download-finished")
	}()
	channel := s.UpdateChannel()
	if channel != "release" && channel != "beta" {
		return fmt.Errorf("updates only install on the release or beta channel -- this copy was built from source")
	}
	if fake := os.Getenv(testUpdateFakeVersionEnv); fake != "" {
		return fmt.Errorf("no release asset in test mode")
	}
	s.mu.Lock()
	backupRunner := s.backupRunner
	u := s.updater
	s.mu.Unlock()

	if backupRunner == nil {
		return fmt.Errorf("update aborted: no pre-update backup available")
	}
	if _, err := backupRunner(0); err != nil {
		return fmt.Errorf("update aborted: pre-update backup failed: %w", err)
	}

	if u == nil {
		return fmt.Errorf("updater not configured")
	}
	if err := u.DownloadAndInstall(context.Background()); err != nil {
		return sanitizeUpdaterError(err)
	}
	// u.DownloadAndInstall already verified the staged download
	// against the published SHA256 digest before returning -- signing
	// only ever runs on that already-verified copy, never before or
	// in place of the digest check (goal 0158's binding order:
	// verify, then re-sign, then the swap RestartApp triggers).
	s.resignStagedBundle(u.DownloadedPath())
	s.mu.Lock()
	s.stagedUpdateVersion = version
	s.mu.Unlock()
	s.markUpdateReady()
	return nil
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

// inAppNotesEndMarker splits a release body's two audiences (goal
// 0127): what the in-app update card shows ends here; the GitHub
// releases page's manual-install instructions live below it --
// nonsense inside an app about to update itself.
const inAppNotesEndMarker = "<!-- in-app-notes-end -->"

// trimReleaseNotesForApp returns only the in-app-facing portion of a
// release body. Bodies without the marker (older releases) pass
// through unchanged; the leading "## What's new" heading is dropped
// since the card supplies its own.
func trimReleaseNotesForApp(body string) string {
	if i := strings.Index(body, inAppNotesEndMarker); i >= 0 {
		body = body[:i]
	}
	body = strings.TrimSpace(body)
	body = strings.TrimPrefix(body, "## What's new")
	return strings.TrimSpace(body)
}

// AppDiagnostics is the copyable root-cause context appended to every
// copyable failure surface across the app (goal 0127: a paste replaces
// a photo) -- version, channel, proxy mode, OS/arch. Proxy reports MODE
// and host only -- a proxy URL may carry credentials, which must
// never enter a paste buffer.
func (s *SettingsService) AppDiagnostics() string {
	proxy := "auto (system)"
	switch raw := s.OutboundProxyURL(); {
	case raw == proxyModeOff:
		proxy = "off (direct)"
	case raw != "":
		if u, err := url.Parse(raw); err == nil {
			proxy = "manual: " + u.Host
		} else {
			proxy = "manual (unparseable)"
		}
	case os.Getenv("HTTPS_PROXY") != "" || os.Getenv("https_proxy") != "":
		proxy = "auto (environment)"
	}
	return fmt.Sprintf("Mill %s · channel %s · proxy %s · %s/%s",
		s.AppVersion(), s.UpdateChannel(), proxy, runtime.GOOS, runtime.GOARCH)
}
