package settingssvc

// End-to-end proof (goal 0175) that the auto-download path runs through
// the EXACT same wails/v3 updater chain as the manual "Update now"
// button -- a real *updater.Updater against a fake Host/Provider pair
// (same construction shape as the updater package's own tests), never
// a parallel mock of DownloadAndInstallUpdate's internals.

import (
	"context"
	"crypto/sha256"
	"io"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/wailsapp/wails/v3/pkg/updater"
)

// waitForCondition polls cond, returning true as soon as it holds or
// false once a short deadline passes -- triggerAutoDownloadPolicy runs
// the download decision in its own goroutine (settingsservice_updatenotice.go),
// so a composition test driving it through CheckForUpdates has no
// synchronous return to block on.
func waitForCondition(t *testing.T, cond func() bool) bool {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return true
		}
		time.Sleep(5 * time.Millisecond)
	}
	return cond()
}

// fakeUpdaterHost satisfies updater.Host with the minimum needed to
// drive Check/DownloadAndInstall headlessly -- Emit/OnEvent are no-ops
// (nothing here asserts on the event stream), OpenWindow is unreachable
// since every call below uses updater.WindowNone via a nil Window
// config (the zero WindowOption), and Quit is counted: the only proof
// this file needs from it is that it is NEVER called by anything auto-
// download touches.
type fakeUpdaterHost struct {
	mu    sync.Mutex
	quits int
}

func (f *fakeUpdaterHost) Emit(string, ...any) bool             { return false }
func (f *fakeUpdaterHost) OnEvent(string, func(any)) func()     { return func() {} }
func (f *fakeUpdaterHost) OpenWindow(updater.WindowOptions) updater.WindowHandle {
	return &fakeUpdaterWindow{}
}
func (f *fakeUpdaterHost) Quit() {
	f.mu.Lock()
	f.quits++
	f.mu.Unlock()
}
func (f *fakeUpdaterHost) quitCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.quits
}

type fakeUpdaterWindow struct{}

func (w *fakeUpdaterWindow) EmitEvent(string, ...any) bool { return false }
func (w *fakeUpdaterWindow) Show()                         {}
func (w *fakeUpdaterWindow) Close()                        {}

// fakeUpdaterProvider serves whatever release/body is currently set,
// letting a test swap both between two DownloadAndInstallUpdate calls
// to simulate a newer build appearing.
//
// releases, when non-empty, overrides rel for Check: each call walks
// to the next entry, repeating the last one once exhausted -- lets a
// test simulate a rolling release channel discovering a newer version
// on ITS OWN across two Check calls (settingsservice_updates.go's own
// re-check retry), rather than the test hand-driving provider.rel
// between two calls it fully controls.
//
// dlErrForVersion, when set for a release's Version, fails Download
// for that specific version instead of writing body -- simulates one
// version's asset being unreachable (a 404 on a since-replaced
// rolling release) while other versions still download fine.
type fakeUpdaterProvider struct {
	rel  *updater.Release
	body []byte

	releases   []*updater.Release
	checkCalls int

	dlErrForVersion map[string]error
	downloadLog     []string
}

func (p *fakeUpdaterProvider) Name() string { return "fake" }
func (p *fakeUpdaterProvider) Check(context.Context, updater.CheckRequest) (*updater.Release, error) {
	if len(p.releases) == 0 {
		return p.rel, nil
	}
	idx := p.checkCalls
	if idx >= len(p.releases) {
		idx = len(p.releases) - 1
	}
	p.checkCalls++
	return p.releases[idx], nil
}
func (p *fakeUpdaterProvider) Download(_ context.Context, r *updater.Release, dst io.Writer, onProgress func(int64, int64)) error {
	p.downloadLog = append(p.downloadLog, r.Version)
	if err, ok := p.dlErrForVersion[r.Version]; ok {
		return err
	}
	if _, err := dst.Write(p.body); err != nil {
		return err
	}
	if onProgress != nil {
		onProgress(int64(len(p.body)), int64(len(p.body)))
	}
	return nil
}

func releaseFor(version string, body []byte) *updater.Release {
	digest := sha256.Sum256(body)
	return &updater.Release{
		Version:  version,
		Artifact: updater.Artifact{Filename: "Mill.app", Size: int64(len(body))},
		Verification: &updater.Verification{
			DigestAlgo: "sha256",
			Digest:     digest[:],
		},
	}
}

// TestDownloadAndInstallUpdate_SupersedeOrderAndNoRestart is the goal
// 0175 acceptance proof, all in one real chain run: backup runs before
// the network step and re-sign runs after it on every install; a
// newer version discards the previous staged artifact rather than
// stacking a second one; and nothing anywhere in the chain ever asks
// the host to Quit (the only path to a restart), since only the
// user-clicked RestartApp may do that.
func TestDownloadAndInstallUpdate_SupersedeOrderAndNoRestart(t *testing.T) {
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

	var mu sync.Mutex
	var order []string
	s.SetBackupRunner(func(int) (string, error) {
		mu.Lock()
		order = append(order, "backup")
		mu.Unlock()
		return "/backups/ok", nil
	})
	swapResignBundleFn(t, func(string) error {
		mu.Lock()
		order = append(order, "resign")
		mu.Unlock()
		return nil
	})

	// First install.
	if _, err := s.CheckForUpdates(); err != nil {
		t.Fatalf("first CheckForUpdates: %v", err)
	}
	if err := s.DownloadAndInstallUpdate(); err != nil {
		t.Fatalf("first DownloadAndInstallUpdate: %v", err)
	}
	if !s.UpdateNoticeState().Ready {
		t.Fatal("want ready after the first install")
	}
	if s.stagedUpdateVersion != "0.4.0-beta.900" {
		t.Errorf("stagedUpdateVersion = %q, want the first release's version", s.stagedUpdateVersion)
	}
	firstPath := u.DownloadedPath()
	if firstPath == "" {
		t.Fatal("want a staged path after the first install")
	}
	if _, err := os.Stat(firstPath); err != nil {
		t.Fatalf("first staged artifact missing from disk: %v", err)
	}

	// A newer release appears and supersedes the staged-but-unrestarted one.
	body2 := []byte("mill-artifact-v2-payload-longer-than-v1")
	provider.rel = releaseFor("0.4.0-beta.905", body2)
	provider.body = body2

	if _, err := s.CheckForUpdates(); err != nil {
		t.Fatalf("second CheckForUpdates: %v", err)
	}
	if err := s.DownloadAndInstallUpdate(); err != nil {
		t.Fatalf("second DownloadAndInstallUpdate: %v", err)
	}
	if s.stagedUpdateVersion != "0.4.0-beta.905" {
		t.Errorf("stagedUpdateVersion = %q, want the second release's version", s.stagedUpdateVersion)
	}
	secondPath := u.DownloadedPath()
	if secondPath == "" || secondPath == firstPath {
		t.Fatalf("second install path = %q, want a fresh path distinct from %q", secondPath, firstPath)
	}
	if _, err := os.Stat(secondPath); err != nil {
		t.Fatalf("second staged artifact missing from disk: %v", err)
	}
	if _, err := os.Stat(firstPath); !os.IsNotExist(err) {
		t.Errorf("first staged artifact still on disk after supersede (err=%v), want it discarded -- never two staged", err)
	}

	mu.Lock()
	gotOrder := append([]string(nil), order...)
	mu.Unlock()
	want := []string{"backup", "resign", "backup", "resign"}
	if len(gotOrder) != len(want) {
		t.Fatalf("call order = %v, want %v", gotOrder, want)
	}
	for i := range want {
		if gotOrder[i] != want[i] {
			t.Fatalf("call order = %v, want %v (backup before the network step, resign after verify succeeds, every install)", gotOrder, want)
		}
	}

	if got := host.quitCount(); got != 0 {
		t.Errorf("host.Quit called %d times across two installs, want 0 -- only RestartApp may ask the host to quit", got)
	}
}

// A digest mismatch must still fail closed through the auto path,
// exactly as it does through the manual button -- proving auto-download
// changes WHEN DownloadAndInstallUpdate is called, never HOW it
// verifies.
func TestDownloadAndInstallUpdate_DigestMismatchFailsClosedThroughAutoPath(t *testing.T) {
	host := &fakeUpdaterHost{}
	rel := releaseFor("0.4.0-beta.900", []byte("expected-bytes"))
	// Corrupt the digest so the streamed body never matches it.
	rel.Verification.Digest[0] ^= 0xFF
	provider := &fakeUpdaterProvider{rel: rel, body: []byte("expected-bytes")}

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
	var resigned bool
	swapResignBundleFn(t, func(string) error { resigned = true; return nil })

	if _, err := s.CheckForUpdates(); err != nil {
		t.Fatalf("CheckForUpdates: %v", err)
	}
	if err := s.DownloadAndInstallUpdate(); err == nil {
		t.Fatal("DownloadAndInstallUpdate with a corrupted digest: want an error, got nil")
	}
	if s.UpdateNoticeState().Ready {
		t.Error("Ready = true after a failed digest verify, want false")
	}
	if resigned {
		t.Error("resign ran after a failed verify, want it never reached")
	}
}

// TestAutoDownloadPolicy_ChecksFeedTheDownloadChainAndCoalesceABurst is
// goal 0207's own composition proof: a CheckForUpdates call -- standing
// in for the manual button, check-on-open, or the background loop's
// own tick, since all three now call the exact same method -- feeds
// the download chain automatically once the opt-in is on, with no
// separate call to DownloadAndInstallUpdate. The burst-coalescing
// property is restated per the amendment: a sequence of found versions
// while a build stays staged-but-unrestarted ends with at most one
// staged artifact (supersede), and a repeat sighting of the version
// already staged never re-downloads it -- never "at most one download
// per dwell window", since dwell no longer exists.
func TestAutoDownloadPolicy_ChecksFeedTheDownloadChainAndCoalesceABurst(t *testing.T) {
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

	if err := s.SetAutoUpdateCheck(true); err != nil {
		t.Fatalf("SetAutoUpdateCheck(true): %v", err)
	}
	t.Cleanup(func() { _ = s.SetAutoUpdateCheck(false) })

	// A single check (the manual button or check-on-open, not a
	// separate Update-now click) is enough to reach Ready -- goal
	// 0207's gap 1: every successful check feeds the same policy.
	if _, err := s.CheckForUpdates(); err != nil {
		t.Fatalf("first CheckForUpdates: %v", err)
	}
	if !waitForCondition(t, func() bool { return s.UpdateNoticeState().Ready }) {
		t.Fatal("update never became ready -- CheckForUpdates must feed maybeAutoDownload automatically")
	}
	firstPath := u.DownloadedPath()
	if firstPath == "" {
		t.Fatal("want a staged path after the first check")
	}

	// A burst: a newer version appears while the first stays
	// staged-but-unrestarted -- supersede, never stack.
	body2 := []byte("mill-artifact-v2-longer-payload")
	provider.rel = releaseFor("0.4.0-beta.905", body2)
	provider.body = body2
	if _, err := s.CheckForUpdates(); err != nil {
		t.Fatalf("second CheckForUpdates: %v", err)
	}
	if !waitForCondition(t, func() bool {
		s.mu.Lock()
		defer s.mu.Unlock()
		return s.stagedUpdateVersion == "0.4.0-beta.905"
	}) {
		t.Fatal("the newer burst version never superseded the staged build")
	}
	secondPath := u.DownloadedPath()
	if secondPath == "" || secondPath == firstPath {
		t.Fatalf("second staged path = %q, want a fresh path distinct from %q", secondPath, firstPath)
	}
	if _, err := os.Stat(firstPath); !os.IsNotExist(err) {
		t.Errorf("first staged artifact still on disk after supersede (err=%v), want it discarded -- at most one staged build", err)
	}

	// A repeat sighting of the version already staged (e.g. the next
	// hourly tick before a restart) must never re-download it.
	if _, err := s.CheckForUpdates(); err != nil {
		t.Fatalf("third CheckForUpdates: %v", err)
	}
	time.Sleep(50 * time.Millisecond)
	if got := u.DownloadedPath(); got != secondPath {
		t.Errorf("DownloadedPath changed to %q after a repeat sighting of the already-staged version, want unchanged %q", got, secondPath)
	}
}
