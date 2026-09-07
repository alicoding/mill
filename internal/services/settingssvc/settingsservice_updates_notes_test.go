package settingssvc

// Acceptance coverage for the accumulated "what's new" list (goal
// 0376): listReleasesNewerThan/buildNotesMarkdown unit-level, then the
// full CheckForUpdates -> UpdateNoticeState -> DownloadAndInstallUpdate
// chain against a real *updater.Updater + fake Host/Provider pair
// (same construction shape as settingsservice_updates_autochain_test.go),
// proving notes breadth never changes what installs.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/wailsapp/wails/v3/pkg/updater"
)

type stubRelease struct {
	TagName     string `json:"tag_name"`
	Body        string `json:"body"`
	Prerelease  bool   `json:"prerelease"`
	Draft       bool   `json:"draft"`
	PublishedAt string `json:"published_at"`
}

// newStubReleasesServer stands in for the GitHub releases-list
// endpoint listReleasesNewerThan calls -- githubAPIBaseURL is swapped
// to point at it for the test's duration, restored on cleanup.
func newStubReleasesServer(t *testing.T, releases []stubRelease) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/releases") {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(releases)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestListReleasesNewerThan_NewestFirstSkipsDraftsAndOlder(t *testing.T) {
	srv := newStubReleasesServer(t, []stubRelease{
		{TagName: "v1.3.0", Body: "third", PublishedAt: "2026-03-01T00:00:00Z"},
		{TagName: "v1.2.1", Draft: true, Body: "draft, must never appear", PublishedAt: "2026-02-15T00:00:00Z"},
		{TagName: "v1.2.0", Body: "second", PublishedAt: "2026-02-01T00:00:00Z"},
		{TagName: "v1.1.0", Body: "first", PublishedAt: "2026-01-01T00:00:00Z"},
		{TagName: "v1.0.0", Body: "not newer", PublishedAt: "2025-12-01T00:00:00Z"},
	})

	entries, truncated, err := listReleasesNewerThan(context.Background(), srv.Client(), srv.URL, "acme/widget", "1.0.0", false)
	if err != nil {
		t.Fatalf("listReleasesNewerThan() error = %v", err)
	}
	if truncated {
		t.Error("truncated = true, want false (page came back under the cap)")
	}
	want := []string{"v1.3.0", "v1.2.0", "v1.1.0"}
	if len(entries) != len(want) {
		t.Fatalf("entries = %+v, want %d entries", entries, len(want))
	}
	for i, v := range want {
		if entries[i].Version != v {
			t.Errorf("entries[%d].Version = %q, want %q (newest-first, draft and not-newer excluded)", i, entries[i].Version, v)
		}
	}
}

func TestListReleasesNewerThan_StableChannelExcludesPrerelease(t *testing.T) {
	srv := newStubReleasesServer(t, []stubRelease{
		{TagName: "v2.0.0-beta.1", Prerelease: true, Body: "beta", PublishedAt: "2026-04-01T00:00:00Z"},
		{TagName: "v1.5.0", Body: "stable", PublishedAt: "2026-03-01T00:00:00Z"},
		{TagName: "v1.0.0", Body: "base", PublishedAt: "2026-01-01T00:00:00Z"},
	})
	entries, _, err := listReleasesNewerThan(context.Background(), srv.Client(), srv.URL, "acme/widget", "1.0.0", false)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Version != "v1.5.0" {
		t.Fatalf("entries = %+v, want just v1.5.0 (prerelease excluded on the stable channel)", entries)
	}
}

func TestListReleasesNewerThan_BetaChannelIncludesPrerelease(t *testing.T) {
	srv := newStubReleasesServer(t, []stubRelease{
		{TagName: "v2.0.0-beta.2", Prerelease: true, Body: "newer beta", PublishedAt: "2026-04-02T00:00:00Z"},
		{TagName: "v1.5.0", Body: "stable", PublishedAt: "2026-03-01T00:00:00Z"},
	})
	entries, _, err := listReleasesNewerThan(context.Background(), srv.Client(), srv.URL, "acme/widget", "1.0.0", true)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 {
		t.Fatalf("entries = %+v, want both the prerelease and the stable release on the beta channel", entries)
	}
}

func TestListReleasesNewerThan_FullPageOfNewerEntriesReportsTruncated(t *testing.T) {
	releases := make([]stubRelease, updaterListReleasesPerPage)
	for i := range releases {
		releases[i] = stubRelease{TagName: fmt.Sprintf("v9.%d.0", updaterListReleasesPerPage-i), Body: "note", PublishedAt: "2026-01-01T00:00:00Z"}
	}
	srv := newStubReleasesServer(t, releases)
	entries, truncated, err := listReleasesNewerThan(context.Background(), srv.Client(), srv.URL, "acme/widget", "0.0.0", false)
	if err != nil {
		t.Fatal(err)
	}
	if !truncated {
		t.Error("truncated = false, want true (a full page where every entry is still newer than installed)")
	}
	if len(entries) != updaterListReleasesPerPage {
		t.Errorf("len(entries) = %d, want %d", len(entries), updaterListReleasesPerPage)
	}
}

func TestIsSemverNewer(t *testing.T) {
	cases := []struct {
		tag, current string
		want         bool
	}{
		{"v2.0.0", "1.0.0", true},
		{"v1.0.0", "v1.0.0", false},
		{"v0.9.0", "v1.0.0", false},
		{"", "1.0.0", false},
		{"1.0.0", "", true},
		{"not-a-version", "1.0.0", false},
	}
	for _, c := range cases {
		if got := isSemverNewer(c.tag, c.current); got != c.want {
			t.Errorf("isSemverNewer(%q, %q) = %v, want %v", c.tag, c.current, got, c.want)
		}
	}
}

func TestBuildNotesMarkdown_HeadsEachEntryAndAppendsTruncationLine(t *testing.T) {
	entries := []UpdateNoteEntry{
		{Version: "v1.2.0", PublishedAt: time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC), Notes: "- fixed a bug"},
		{Version: "v1.1.0", Notes: ""},
	}
	md := buildNotesMarkdown(entries, true)
	if !strings.Contains(md, "### v1.2.0 · Mar 1, 2026") {
		t.Errorf("markdown missing the dated header: %q", md)
	}
	if !strings.Contains(md, "### v1.1.0\n\n"+updatesNotesEmptyCopy) {
		t.Errorf("markdown missing the undated entry's header and empty-notes copy: %q", md)
	}
	if !strings.HasSuffix(strings.TrimSpace(md), updatesNotesTruncatedCopy) {
		t.Errorf("markdown does not end with the truncation line: %q", md)
	}
}

// wireNotesSource points a real SettingsService at srv for the notes
// enumeration call, restoring githubAPIBaseURL after the test.
func wireNotesSource(t *testing.T, s *SettingsService, srv *httptest.Server, repo string, prerelease bool) {
	t.Helper()
	prevBase := githubAPIBaseURL
	githubAPIBaseURL = srv.URL
	t.Cleanup(func() { githubAPIBaseURL = prevBase })
	s.setUpdaterNotesSource(repo, prerelease, srv.Client())
}

// Acceptance: a check that skipped several versions renders one
// headed section per release, newest first, through the full
// CheckForUpdates -> UpdateNoticeState chain.
func TestUpdateNoticeState_MultiVersionCheckRendersOneSectionPerRelease(t *testing.T) {
	srv := newStubReleasesServer(t, []stubRelease{
		{TagName: "v1.3.0", Body: "- third release note", PublishedAt: "2026-03-01T00:00:00Z"},
		{TagName: "v1.2.0", Body: "- second release note", PublishedAt: "2026-02-01T00:00:00Z"},
		{TagName: "v1.1.0", Body: "- first release note", PublishedAt: "2026-01-01T00:00:00Z"},
	})

	host := &fakeUpdaterHost{}
	provider := &fakeUpdaterProvider{rel: releaseFor("1.3.0", []byte("payload"))}
	u := updater.New(host)
	if err := u.Init(updater.Config{CurrentVersion: "1.0.0", Providers: []updater.Provider{provider}}); err != nil {
		t.Fatalf("Init: %v", err)
	}

	s := newTestSettingsService(t)
	s.SetUpdater(u)
	wireNotesSource(t, s, srv, "acme/widget", false)

	if _, err := s.CheckForUpdates(); err != nil {
		t.Fatalf("CheckForUpdates: %v", err)
	}

	n := s.UpdateNoticeState()
	if n.NotesVersion != "1.3.0" {
		t.Errorf("NotesVersion = %q, want the newest entry %q", n.NotesVersion, "1.3.0")
	}
	if got := strings.Count(n.NotesHTML, "<h3"); got != 3 {
		t.Errorf("NotesHTML has %d <h3> sections, want 3 (one per skipped release): %q", got, n.NotesHTML)
	}
	iThird := strings.Index(n.NotesHTML, "v1.3.0")
	iSecond := strings.Index(n.NotesHTML, "v1.2.0")
	iFirst := strings.Index(n.NotesHTML, "v1.1.0")
	if iThird < 0 || iThird >= iSecond || iSecond >= iFirst {
		t.Errorf("sections not newest-first in NotesHTML: %q", n.NotesHTML)
	}
	for _, want := range []string{"third release note", "second release note", "first release note"} {
		if !strings.Contains(n.NotesHTML, want) {
			t.Errorf("NotesHTML missing %q: %q", want, n.NotesHTML)
		}
	}
}

// Acceptance: a one-release-newer check renders exactly what the
// pre-existing single-notes render always showed (the same <li> items,
// unmodified body) plus the new per-entry header -- the only visible
// change in the one-release case.
func TestUpdateNoticeState_OneReleaseNewerRendersTodaysBodyPlusHeader(t *testing.T) {
	t.Setenv(testUpdateFakeVersionEnv, "9.9.9")
	s := newTestSettingsService(t)

	if _, err := s.CheckForUpdates(); err != nil {
		t.Fatalf("CheckForUpdates: %v", err)
	}

	n := s.UpdateNoticeState()
	if !strings.Contains(n.NotesHTML, "<li>Fake note one</li>") || !strings.Contains(n.NotesHTML, "<li>Fake note two</li>") {
		t.Errorf("NotesHTML = %q, want the same body content as before this goal", n.NotesHTML)
	}
	if strings.Contains(n.NotesHTML, "xattr slop") {
		t.Error("NotesHTML carries the trimmed manual-install tail")
	}
	if got := strings.Count(n.NotesHTML, "<h3"); got != 1 {
		t.Errorf("NotesHTML has %d <h3> headers, want exactly 1 (the only addition in the one-release case)", got)
	}
	if !strings.Contains(n.NotesHTML, "9.9.9") {
		t.Errorf("NotesHTML missing the version header text: %q", n.NotesHTML)
	}
}

// Acceptance: notes breadth is strictly additive -- the install target
// DownloadAndInstallUpdate stages is always u.Check()'s own resolved
// release, never the newest entry the notes enumeration happens to
// find. The stub server here deliberately reports a release (v1.3.0)
// the install-path Provider does NOT know about, so a test that
// installed the notes list's newest entry instead of Check()'s own
// result would fail this assertion.
func TestDownloadAndInstallUpdate_InstallsCheckResultNotNewestNotesEntry(t *testing.T) {
	srv := newStubReleasesServer(t, []stubRelease{
		{TagName: "v1.3.0", Body: "a release the install Provider never resolved", PublishedAt: "2026-03-01T00:00:00Z"},
		{TagName: "v1.2.0", Body: "the release Check() actually resolved", PublishedAt: "2026-02-01T00:00:00Z"},
	})

	host := &fakeUpdaterHost{}
	body := []byte("mill-artifact-payload")
	provider := &fakeUpdaterProvider{rel: releaseFor("1.2.0", body), body: body}
	u := updater.New(host)
	if err := u.Init(updater.Config{CurrentVersion: "1.0.0", Providers: []updater.Provider{provider}}); err != nil {
		t.Fatalf("Init: %v", err)
	}

	s := newTestSettingsService(t)
	s.SetUpdater(u)
	s.SetUpdateChannel("beta")
	wireNotesSource(t, s, srv, "acme/widget", false)
	s.SetBackupRunner(func(int) (string, error) { return "/backups/ok", nil })
	swapResignBundleFn(t, func(string) error { return nil })

	result, err := s.CheckForUpdates()
	if err != nil {
		t.Fatalf("CheckForUpdates: %v", err)
	}
	if result.Version != "1.2.0" {
		t.Fatalf("CheckForUpdates() Version = %q, want the install Provider's own result %q", result.Version, "1.2.0")
	}
	if v := s.UpdateNoticeState().NotesVersion; v != "1.3.0" {
		t.Fatalf("NotesVersion = %q, want the notes list's newest entry %q (must differ from the install target for this test to prove anything)", v, "1.3.0")
	}

	if err := s.DownloadAndInstallUpdate(); err != nil {
		t.Fatalf("DownloadAndInstallUpdate: %v", err)
	}
	if s.stagedUpdateVersion != "1.2.0" {
		t.Errorf("stagedUpdateVersion = %q, want Check()'s own result %q -- notes breadth must never change what installs", s.stagedUpdateVersion, "1.2.0")
	}
}

// Acceptance: an enumeration failure (the notes-list host unreachable)
// must never hide the found-update result -- it degrades to the
// single release Check() itself resolved.
func TestUpdateNoticeState_NotesEnumerationFailureFallsBackToSingleEntry(t *testing.T) {
	host := &fakeUpdaterHost{}
	provider := &fakeUpdaterProvider{rel: releaseFor("1.2.0", []byte("payload"))}
	provider.rel.Notes = "- the only note Check() itself carried"
	u := updater.New(host)
	if err := u.Init(updater.Config{CurrentVersion: "1.0.0", Providers: []updater.Provider{provider}}); err != nil {
		t.Fatalf("Init: %v", err)
	}

	s := newTestSettingsService(t)
	s.SetUpdater(u)
	// A repo pointed at a closed connection: listReleasesNewerThan
	// fails, buildUpdateNoteEntries must fall back rather than drop
	// the found-update result.
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	srv.Close()
	wireNotesSource(t, s, srv, "acme/widget", false)

	if _, err := s.CheckForUpdates(); err != nil {
		t.Fatalf("CheckForUpdates: %v", err)
	}
	n := s.UpdateNoticeState()
	if n.NotesVersion != "1.2.0" {
		t.Errorf("NotesVersion = %q, want the fallback single entry %q", n.NotesVersion, "1.2.0")
	}
	if !strings.Contains(n.NotesHTML, "the only note Check() itself carried") {
		t.Errorf("NotesHTML = %q, want the fallback entry's own notes", n.NotesHTML)
	}
}
