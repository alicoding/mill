package settingssvc

// Regression coverage for the beta channel's own merge tempo: it keeps
// exactly one rolling release, so every merge to main deletes the
// previous release's asset. CheckForUpdates can find version N, and by
// the time DownloadAndInstallUpdate's asset request lands, the release
// has already rolled to N+1 -- a 404 on a real, valid update. These
// tests drive the same real *updater.Updater + fake Host/Provider pair
// as settingsservice_updates_autochain_test.go (never a parallel mock
// of DownloadAndInstallUpdate's internals).

import (
	"errors"
	"strings"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/updater"
)

// Regression: a stale-asset 404 must trigger exactly one fresh
// CheckForUpdates and, finding a newer version, transparently download
// THAT asset instead of surfacing the dead link.
func TestDownloadAndInstallUpdate_RecoversFromStaleAssetOnRollingBeta(t *testing.T) {
	host := &fakeUpdaterHost{}
	body2 := []byte("mill-artifact-v2-payload")
	rel1 := releaseFor("0.4.0-beta.900", []byte("mill-artifact-v1-payload"))
	rel2 := releaseFor("0.4.0-beta.901", body2)
	provider := &fakeUpdaterProvider{
		releases: []*updater.Release{rel1, rel2},
		body:     body2,
		dlErrForVersion: map[string]error{
			"0.4.0-beta.900": errors.New("github: download: HTTP 404"),
		},
	}

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

	if _, err := s.CheckForUpdates(); err != nil {
		t.Fatalf("initial CheckForUpdates: %v", err)
	}

	if err := s.DownloadAndInstallUpdate(); err != nil {
		t.Fatalf("DownloadAndInstallUpdate() = %v, want the stale-asset retry to succeed", err)
	}

	notice := s.UpdateNoticeState()
	if notice.State != UpdateStateReady {
		t.Errorf("State = %q, want %q", notice.State, UpdateStateReady)
	}
	if notice.StateVersion != "0.4.0-beta.901" {
		t.Errorf("StateVersion = %q, want the re-checked 0.4.0-beta.901, not the stale 0.4.0-beta.900", notice.StateVersion)
	}
	if s.stagedUpdateVersion != "0.4.0-beta.901" {
		t.Errorf("stagedUpdateVersion = %q, want the re-checked version", s.stagedUpdateVersion)
	}

	if got := provider.downloadLog; len(got) != 2 || got[0] != "0.4.0-beta.900" || got[1] != "0.4.0-beta.901" {
		t.Errorf("download attempts = %v, want exactly [0.4.0-beta.900 0.4.0-beta.901] -- one failed try, one retry, never a loop", got)
	}
	if provider.checkCalls != 2 {
		t.Errorf("Check calls = %d, want exactly 2 (the original CheckForUpdates + one re-check)", provider.checkCalls)
	}
}

// A genuine 404 -- the re-check finds nothing newer than the version
// that just failed -- must surface the original honest error and must
// NOT attempt the download a second time.
func TestDownloadAndInstallUpdate_GenuineNotFoundSurfacesHonestError(t *testing.T) {
	host := &fakeUpdaterHost{}
	rel := releaseFor("0.4.0-beta.900", []byte("mill-artifact-payload"))
	provider := &fakeUpdaterProvider{
		releases: []*updater.Release{rel},
		dlErrForVersion: map[string]error{
			"0.4.0-beta.900": errors.New("github: download: HTTP 404"),
		},
	}

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

	if _, err := s.CheckForUpdates(); err != nil {
		t.Fatalf("initial CheckForUpdates: %v", err)
	}

	err := s.DownloadAndInstallUpdate()
	if err == nil {
		t.Fatal("DownloadAndInstallUpdate() = nil, want the genuine 404 to surface")
	}
	if !strings.Contains(err.Error(), "404") {
		t.Errorf("error = %q, want it to still name the 404", err)
	}
	if s.UpdateNoticeState().State != UpdateStateError {
		t.Errorf("State = %q, want %q", s.UpdateNoticeState().State, UpdateStateError)
	}
	if got := provider.downloadLog; len(got) != 1 || got[0] != "0.4.0-beta.900" {
		t.Errorf("download attempts = %v, want exactly one try -- a same-version re-check must not retry the download", got)
	}
	if provider.checkCalls != 2 {
		t.Errorf("Check calls = %d, want exactly 2 (the original CheckForUpdates + one re-check)", provider.checkCalls)
	}
}

// A download failure unrelated to a stale asset (a network error, a
// non-404 status) must never trigger the re-check retry at all.
func TestDownloadAndInstallUpdate_NonStaleAssetFailureNeverRetries(t *testing.T) {
	host := &fakeUpdaterHost{}
	rel := releaseFor("0.4.0-beta.900", []byte("mill-artifact-payload"))
	provider := &fakeUpdaterProvider{
		releases: []*updater.Release{rel},
		dlErrForVersion: map[string]error{
			"0.4.0-beta.900": errors.New("dial tcp: connection reset by peer"),
		},
	}

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

	if _, err := s.CheckForUpdates(); err != nil {
		t.Fatalf("initial CheckForUpdates: %v", err)
	}

	err := s.DownloadAndInstallUpdate()
	if err == nil {
		t.Fatal("DownloadAndInstallUpdate() = nil, want the network error to surface")
	}
	if !strings.Contains(err.Error(), "connection reset") {
		t.Errorf("error = %q, want the original network error unchanged", err)
	}
	if provider.checkCalls != 1 {
		t.Errorf("Check calls = %d, want exactly 1 -- a non-404 failure must never trigger a re-check", provider.checkCalls)
	}
}

func TestIsStaleAssetDownloadError(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{"exact 404 shape", errors.New("github: download: HTTP 404"), true},
		{"other status", errors.New("github: download: HTTP 500"), false},
		{"unrelated error", errors.New("dial tcp: timeout"), false},
		{"nil", nil, false},
	}
	for _, c := range cases {
		if got := isStaleAssetDownloadError(c.err); got != c.want {
			t.Errorf("isStaleAssetDownloadError(%v) = %v, want %v", c.err, got, c.want)
		}
	}
}
