package settingssvc

// The accumulated "what's new" list (goal 0376): CheckForUpdates' own
// enumeration of every release newer than installed, split out of
// settingsservice_updates.go at the 500-line convention
// (architecture.md).

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/Masterminds/semver/v3"
	"github.com/wailsapp/wails/v3/pkg/updater"
)

// githubAPIBaseURL is the same host the vendored GitHub provider
// (github.go's defaultBaseURL) already contacts on every check --
// listReleasesNewerThan is a second call to the SAME outbound host,
// not a new phone-home surface. A var, not a const, only so tests can
// point buildUpdateNoteEntries at an httptest.Server instead of the
// real API.
var githubAPIBaseURL = "https://api.github.com"

// updaterListReleasesPerPage caps the "what's new" enumeration at the
// newest N releases (a deliberate divergence from an unbounded walk):
// large enough to cover a beta channel's per-merge release cadence
// between two checks, without an unbounded GitHub API walk.
// updatesNotesTruncatedCopy's wording is pinned to this exact number.
const updaterListReleasesPerPage = 20

// updatesNotesEmptyCopy/updatesNotesTruncatedCopy mirror
// frontend/src/locales/en/app.json's updates.notes.empty/truncated
// keys byte-for-byte. Go has no i18n runtime to resolve a locale key
// against at render time -- the composed markdown is rendered to HTML
// server-side and shipped as one opaque string -- so the literal
// English text lives here too; keep both in sync by hand.
const (
	updatesNotesEmptyCopy     = "No notes for this version."
	updatesNotesTruncatedCopy = "Showing the 20 newest versions."
)

// UpdateNoteEntry is one release's notes within the accumulated
// "what's new" list -- recordUpdateNotes stores these newest-first so
// a check that skipped several versions renders every one, not just
// the last found result.
type UpdateNoteEntry struct {
	// Version is the tag as GitHub published it (e.g.
	// "v0.98.0-beta.2393") -- display-only; install-target comparison
	// still runs on updater.Release.Version's SemVer-trimmed form,
	// untouched by this list.
	Version     string
	PublishedAt time.Time
	// Notes is already trimmed (trimReleaseNotesForApp) -- the
	// manual-install tail below the in-app-notes-end marker never
	// reaches here.
	Notes string
}

// apiListRelease is the subset of GitHub's releases-list response this
// file needs, decoded independently of wails/v3's own vendored
// apiRelease (pkg/updater/providers/github/github.go), which is
// unexported outside that module.
type apiListRelease struct {
	TagName     string    `json:"tag_name"`
	Body        string    `json:"body"`
	Prerelease  bool      `json:"prerelease"`
	Draft       bool      `json:"draft"`
	PublishedAt time.Time `json:"published_at"`
}

// listReleasesNewerThan enumerates every release the GitHub Releases
// API reports as newer than currentVersion, newest first, over ONE
// per_page page (updaterListReleasesPerPage) -- the same endpoint the
// vendored provider's own beta path already calls
// (github.go:117-124's /releases?per_page=10), widened here to list
// every skipped release rather than stopping at the first non-draft
// one. Draft releases are always skipped: a still-drafting release is
// invisible to every client until the CI job that created it flips it
// published. prerelease mirrors Check's own filter -- false keeps only
// non-prerelease entries (the stable channel), true keeps everything
// (the beta channel already sees both under today's Check).
//
// truncated reports whether more newer releases might exist beyond
// this one page: true only when the raw page came back full AND every
// examined entry through the last one was still newer than
// currentVersion, so the "no longer newer" boundary was never actually
// found within the page.
func listReleasesNewerThan(ctx context.Context, httpClient *http.Client, baseURL, repo, currentVersion string, prerelease bool) ([]updater.Release, bool, error) {
	list, err := fetchReleasesPage(ctx, httpClient, baseURL, repo)
	if err != nil {
		return nil, false, err
	}
	return newerReleaseEntries(list, currentVersion, prerelease), pageLooksTruncated(list, currentVersion, prerelease), nil
}

// fetchReleasesPage fetches and decodes one page of the GitHub
// releases-list endpoint -- the HTTP/JSON half of
// listReleasesNewerThan, split out so the filtering logic below stays
// under the cognitive-complexity gate on its own.
func fetchReleasesPage(ctx context.Context, httpClient *http.Client, baseURL, repo string) ([]apiListRelease, error) {
	endpoint := fmt.Sprintf("%s/repos/%s/releases?per_page=%d", strings.TrimRight(baseURL, "/"), repo, updaterListReleasesPerPage)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("github: list releases: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode == http.StatusNotFound {
		return nil, nil
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("github: list releases %d: %s", resp.StatusCode, body)
	}
	var list []apiListRelease
	if err := json.NewDecoder(resp.Body).Decode(&list); err != nil {
		return nil, fmt.Errorf("github: decode releases list: %w", err)
	}
	return list, nil
}

// visibleOnChannel reports whether rel is one this channel's Check
// would ever consider -- never a draft, and never a prerelease on the
// stable channel.
func visibleOnChannel(rel apiListRelease, prerelease bool) bool {
	if rel.Draft {
		return false
	}
	return prerelease || !rel.Prerelease
}

// newerReleaseEntries walks list (newest first, as GitHub returns it)
// and keeps every channel-visible entry newer than currentVersion,
// stopping at the first one that isn't.
func newerReleaseEntries(list []apiListRelease, currentVersion string, prerelease bool) []updater.Release {
	var entries []updater.Release
	for _, rel := range list {
		if !visibleOnChannel(rel, prerelease) {
			continue
		}
		if !isSemverNewer(rel.TagName, currentVersion) {
			break
		}
		entries = append(entries, updater.Release{
			Version:     rel.TagName,
			Notes:       rel.Body,
			PublishedAt: rel.PublishedAt,
		})
	}
	return entries
}

// pageLooksTruncated reports whether more newer releases might exist
// beyond this one page: true only when the raw page came back full AND
// every channel-visible entry through the last one was still newer
// than currentVersion, so the "no longer newer" boundary was never
// actually found within the page.
func pageLooksTruncated(list []apiListRelease, currentVersion string, prerelease bool) bool {
	if len(list) != updaterListReleasesPerPage {
		return false
	}
	for _, rel := range list {
		if !visibleOnChannel(rel, prerelease) {
			continue
		}
		if !isSemverNewer(rel.TagName, currentVersion) {
			return false
		}
	}
	return true
}

// isSemverNewer mirrors wails/v3's own updater/internal/semver.IsNewer
// (unexported outside that module, so unusable directly here) using
// Mill's existing Masterminds/semver/v3 dependency: an invalid tag
// never counts as newer; an empty current version means any valid tag
// does.
func isSemverNewer(tag, current string) bool {
	tagV, err := semver.NewVersion(tag)
	if err != nil {
		return false
	}
	if current == "" {
		return true
	}
	curV, err := semver.NewVersion(current)
	if err != nil {
		return true
	}
	return tagV.GreaterThan(curV)
}

// trimVersionPrefix strips a leading "v"/"V" -- the same convention
// wails/v3's semver.TrimPrefix applies, reimplemented here since that
// helper lives under an unexported internal/ path.
func trimVersionPrefix(v string) string {
	if strings.HasPrefix(v, "v") || strings.HasPrefix(v, "V") {
		return v[1:]
	}
	return v
}

// setUpdaterNotesSource stashes InitUpdater's own repo/channel/client
// inputs -- see the SettingsService struct field doc comment for why.
func (s *SettingsService) setUpdaterNotesSource(repo string, prerelease bool, client *http.Client) {
	s.mu.Lock()
	s.updaterRepo = repo
	s.updaterPrerelease = prerelease
	s.updaterHTTPClient = client
	s.mu.Unlock()
}

// buildUpdateNoteEntries turns a found CheckForUpdates result into the
// accumulated notes list: every release newer than installed when the
// enumeration call succeeds, else the single release Check() itself
// resolved. An enumeration failure (rate limit, offline) must never
// hide the found-update result, so notes breadth degrades gracefully
// to the one-entry case rather than failing the check.
func (s *SettingsService) buildUpdateNoteEntries(ctx context.Context, currentVersion string, rel *updater.Release) ([]UpdateNoteEntry, bool) {
	s.mu.Lock()
	repo := s.updaterRepo
	prerelease := s.updaterPrerelease
	client := s.updaterHTTPClient
	s.mu.Unlock()
	if repo != "" && client != nil {
		if releases, truncated, err := listReleasesNewerThan(ctx, client, githubAPIBaseURL, repo, currentVersion, prerelease); err == nil && len(releases) > 0 {
			entries := make([]UpdateNoteEntry, len(releases))
			for i, r := range releases {
				entries[i] = UpdateNoteEntry{Version: r.Version, PublishedAt: r.PublishedAt, Notes: trimReleaseNotesForApp(r.Notes)}
			}
			return entries, truncated
		}
	}
	// rel.Metadata["github.release.tag"] carries the raw tag GitHub
	// published (github.go:158) -- preferred over rel.Version so the
	// fallback single entry displays the same "tag as published" form
	// the enumerated path uses, instead of the SemVer-trimmed version.
	tag := rel.Version
	if t, ok := rel.Metadata["github.release.tag"].(string); ok && t != "" {
		tag = t
	}
	return []UpdateNoteEntry{{Version: tag, PublishedAt: rel.PublishedAt, Notes: trimReleaseNotesForApp(rel.Notes)}}, false
}

// buildNotesMarkdown composes entries (newest first) into one markdown
// document for UpdateNoticeState's single NotesHTML field: each
// release gets its own "### {version} · {date}" heading followed by
// its trimmed notes, so a check that skipped several versions still
// renders through the SAME single-string markdown.RenderHTML pipeline
// the one-release case always used. An entry with no notes renders the
// header alone plus updatesNotesEmptyCopy. truncated appends
// updatesNotesTruncatedCopy as its own trailing paragraph.
func buildNotesMarkdown(entries []UpdateNoteEntry, truncated bool) string {
	var sb strings.Builder
	for i, e := range entries {
		if i > 0 {
			sb.WriteString("\n\n")
		}
		sb.WriteString("### ")
		sb.WriteString(e.Version)
		if !e.PublishedAt.IsZero() {
			sb.WriteString(" · ")
			sb.WriteString(e.PublishedAt.Format("Jan 2, 2006"))
		}
		sb.WriteString("\n\n")
		if e.Notes == "" {
			sb.WriteString(updatesNotesEmptyCopy)
		} else {
			sb.WriteString(e.Notes)
		}
	}
	if truncated {
		sb.WriteString("\n\n")
		sb.WriteString(updatesNotesTruncatedCopy)
	}
	return sb.String()
}

// testUpdateFakeNotesCountEnv makes fake mode's found-result seed N
// synthetic entries in the accumulated "what's new" list instead of
// one, so the multi-section render can be verified without a real
// GitHub release history. Ignored (a single entry) when unset,
// non-numeric, or <= 1.
const testUpdateFakeNotesCountEnv = "MILL_TEST_UPDATE_FAKE_NOTES_COUNT"

// fakeNoteEntries builds fake mode's notes list: just the found
// version by default, or testUpdateFakeNotesCountEnv-many synthesized
// older-but-still-newer entries, newest first, when set.
func fakeNoteEntries(version, notes string) []UpdateNoteEntry {
	n, err := strconv.Atoi(os.Getenv(testUpdateFakeNotesCountEnv))
	if err != nil || n <= 1 {
		return []UpdateNoteEntry{{Version: version, Notes: notes}}
	}
	published := time.Now()
	entries := make([]UpdateNoteEntry, n)
	entries[0] = UpdateNoteEntry{Version: version, PublishedAt: published, Notes: notes}
	for i := 1; i < n; i++ {
		entries[i] = UpdateNoteEntry{
			Version:     fmt.Sprintf("%s-skipped.%d", version, i),
			PublishedAt: published.AddDate(0, 0, -i),
			Notes:       fmt.Sprintf("- Fake note for skipped release %d", i),
		}
	}
	return entries
}
