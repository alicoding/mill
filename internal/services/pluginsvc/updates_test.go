package pluginsvc

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeInstalledUpdateFixture(t *testing.T, svc *PluginService, rec InstallRecord) {
	t.Helper()
	id := "fixture"
	plugin := filepath.Join(svc.dir, id)
	if err := os.MkdirAll(plugin, 0o750); err != nil {
		t.Fatal(err)
	}
	for rel, body := range map[string]string{
		"manifest.json": fmt.Sprintf(`{"id":%q,"name":"Fixture","version":"1.0.0"}`, id),
		"main.js":       "export function activate() {}",
	} {
		if err := os.WriteFile(filepath.Join(plugin, rel), []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	rec.Version = "1.0.0"
	if rec.Tier == "" {
		rec.Tier = TierUnverified
	}
	if err := WriteInstallRecord(plugin, rec); err != nil {
		t.Fatal(err)
	}
}

func TestNewerVersion_TableOfComparisons(t *testing.T) {
	cases := []struct {
		available, installed string
		want                 bool
	}{
		{"1.1.0", "1.0.0", true},
		{"v1.1.0", "1.0.0", true},
		{"2.0.0", "v1.9.9", true},
		{"1.0.0", "1.0.0", false},
		{"0.9.0", "1.0.0", false},
		{"1.0.0-beta.1", "1.0.0", false},
		{"1.0.0", "1.0.0-beta.1", true},
		{"latest", "1.0.0", false},
		{"1.1.0", "", false},
		{"", "1.0.0", false},
	}
	for _, c := range cases {
		if got := NewerVersion(c.available, c.installed); got != c.want {
			t.Errorf("NewerVersion(%q, %q) = %v, want %v", c.available, c.installed, got, c.want)
		}
	}
}

func TestLatestReleaseURL_AndTagParse(t *testing.T) {
	if got := LatestReleaseURL("acme/notes"); got != "https://api.github.com/repos/acme/notes/releases/latest" {
		t.Errorf("LatestReleaseURL = %q", got)
	}
	tag, err := ParseLatestReleaseTag([]byte(`{"tag_name":"v2.0.0","name":"2.0.0"}`))
	if err != nil || tag != "v2.0.0" {
		t.Errorf("ParseLatestReleaseTag = %q, %v", tag, err)
	}
	if _, err := ParseLatestReleaseTag([]byte(`{"message":"Not Found"}`)); err == nil {
		t.Error("a body without tag_name parsed")
	}
}

// writeFolderMarketplace lays out a folder marketplace with one
// path-sourced plugin at the given version, returning the marketplace
// root. Called again with a newer version to simulate a publisher's
// release.
func writeFolderMarketplace(t *testing.T, root, version string) {
	t.Helper()
	plugin := filepath.Join(root, "fx-notes")
	if err := os.MkdirAll(filepath.Join(root, ".mill"), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(plugin, 0o750); err != nil {
		t.Fatal(err)
	}
	index := fmt.Sprintf(`{"name":"fx","owner":{"name":"Fixture"},"plugins":[{"id":"fx-notes","name":"Fixture notes","version":%q,"source":{"kind":"path","path":"fx-notes"}}]}`, version)
	manifest := fmt.Sprintf(`{"id":"fx-notes","name":"Fixture notes","version":%q,"contributes":{}}`, version)
	for rel, body := range map[string]string{
		".mill/marketplace.json": index,
		"fx-notes/manifest.json": manifest,
		"fx-notes/main.js":       "export function activate() {}",
	} {
		if err := os.WriteFile(filepath.Join(root, filepath.FromSlash(rel)), []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
}

func installedVersion(t *testing.T, svc *PluginService, id string) string {
	t.Helper()
	infos, err := svc.ListPlugins()
	if err != nil {
		t.Fatal(err)
	}
	for _, info := range infos {
		if info.Manifest.ID == id {
			return info.Manifest.Version
		}
	}
	t.Fatalf("%s is not installed", id)
	return ""
}

// The marketplace path end to end: install at 1.0.0, the publisher
// bumps to 1.1.0, a check lists exactly that, applying it lands 1.1.0
// through the same install door, and the list empties.
func TestCheckForUpdates_MarketplaceEntryOffersOnlyANewerVersion(t *testing.T) {
	svc, _ := newStoreService(t)
	market := t.TempDir()
	writeFolderMarketplace(t, market, "1.0.0")
	if _, err := svc.AddMarketplaceSource(market); err != nil {
		t.Fatalf("AddMarketplaceSource: %v", err)
	}
	if _, err := svc.InstallFromMarketplace("fx", "fx-notes"); err != nil {
		t.Fatalf("InstallFromMarketplace: %v", err)
	}

	// Nothing newer yet: no candidate, and the check is recorded.
	check, err := svc.CheckForUpdates()
	if err != nil {
		t.Fatal(err)
	}
	if len(check.Candidates) != 0 || check.CheckedAt == "" {
		t.Fatalf("first check = %+v, want no candidates and a timestamp", check)
	}

	// An OLDER publication is never offered.
	writeFolderMarketplace(t, market, "0.9.0")
	check, err = svc.CheckForUpdates()
	if err != nil {
		t.Fatal(err)
	}
	if len(check.Candidates) != 0 {
		t.Fatalf("a downgrade was offered: %+v", check.Candidates)
	}

	writeFolderMarketplace(t, market, "1.1.0")
	check, err = svc.CheckForUpdates()
	if err != nil {
		t.Fatal(err)
	}
	if len(check.Candidates) != 1 {
		t.Fatalf("candidates = %+v, want one", check.Candidates)
	}
	cand := check.Candidates[0]
	if cand.ID != "fx-notes" || cand.Installed != "1.0.0" || cand.Available != "1.1.0" || cand.Marketplace != "fx" || cand.Tier != TierDev {
		t.Errorf("candidate = %+v", cand)
	}

	// The recorded check survives a re-read, and the preview promises
	// the same tier the candidate does.
	listed, err := svc.ListUpdates()
	if err != nil || len(listed.Candidates) != 1 {
		t.Fatalf("ListUpdates = %+v, %v", listed, err)
	}
	pv, err := svc.PreviewUpdate("fx-notes")
	if err != nil || pv.Tier != TierDev || !pv.AlreadyInstalled || pv.Version != "1.1.0" {
		t.Fatalf("PreviewUpdate = %+v, %v", pv, err)
	}

	rec, err := svc.UpdatePlugin("fx-notes")
	if err != nil {
		t.Fatalf("UpdatePlugin: %v", err)
	}
	if rec.Version != "1.1.0" || rec.Tier != TierDev || rec.Marketplace != "fx" {
		t.Errorf("record = %+v", rec)
	}
	if got := installedVersion(t, svc, "fx-notes"); got != "1.1.0" {
		t.Errorf("installed version = %q, want 1.1.0", got)
	}
	listed, _ = svc.ListUpdates()
	if len(listed.Candidates) != 0 {
		t.Errorf("the applied update is still listed: %+v", listed.Candidates)
	}
	if _, err := svc.UpdatePlugin("fx-notes"); err == nil {
		t.Error("updating with no known candidate succeeded")
	}
}

// The repository path: a receipt naming a repo asks that repo's latest
// release, and applying the update fetches the release asset the
// standard names (<id>-<version>.zip) -- unverified, since nothing
// declared a hash.
func TestCheckForUpdates_RepositoryReleaseIsFetchedByAssetName(t *testing.T) {
	svc, dir := newStoreService(t)
	origin := SourceOrigin{Kind: "github", Locator: "acme/notes"}
	writePolicy(t, `{"version":2,"managedBy":"Org","sources":[{"kind":"github","locator":"acme/notes","artifactOrigins":["https://api.github.com","https://github.com"]}]}`)
	plugin := filepath.Join(dir, "acme-notes")
	if err := os.MkdirAll(plugin, 0o750); err != nil {
		t.Fatal(err)
	}
	for rel, body := range map[string]string{
		"manifest.json": `{"id":"acme-notes","name":"Acme notes","version":"1.0.0"}`,
		"main.js":       "export function activate() {}",
	} {
		if err := os.WriteFile(filepath.Join(plugin, rel), []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := WriteInstallRecord(plugin, InstallRecord{Source: PluginSource{Kind: "github", Repo: "acme/notes"}, Origin: origin, Version: "1.0.0", Tier: TierUnverified}); err != nil {
		t.Fatal(err)
	}
	asset := zipOf(t, map[string]string{
		"acme-notes-2.0.0/manifest.json": `{"id":"acme-notes","name":"Acme notes","version":"2.0.0"}`,
		"acme-notes-2.0.0/main.js":       "export function activate() {}",
	})
	var fetched []string
	svc.SetDownloader(func(url string, _ int64) ([]byte, error) {
		fetched = append(fetched, url)
		switch url {
		case LatestReleaseURL("acme/notes"):
			return []byte(`{"tag_name":"v2.0.0"}`), nil
		case "https://github.com/acme/notes/releases/download/v2.0.0/acme-notes-2.0.0.zip":
			return asset, nil
		}
		return nil, fmt.Errorf("nothing is published at that address")
	})

	check, err := svc.CheckForUpdates()
	if err != nil {
		t.Fatal(err)
	}
	if len(check.Candidates) != 1 || check.Candidates[0].Available != "2.0.0" || check.Candidates[0].Tier != TierUnverified {
		t.Fatalf("candidates = %+v", check.Candidates)
	}
	if _, err := svc.UpdatePlugin("acme-notes"); err != nil {
		t.Fatalf("UpdatePlugin: %v", err)
	}
	if got := installedVersion(t, svc, "acme-notes"); got != "2.0.0" {
		t.Errorf("installed version = %q, want 2.0.0", got)
	}
	if !strings.Contains(strings.Join(fetched, "\n"), "acme-notes-2.0.0.zip") {
		t.Errorf("the release asset was not fetched by its standard name: %v", fetched)
	}
}

// A repository that answers no release is a problem the check names,
// never a silent "up to date".
func TestCheckForUpdates_UnreachableSourceIsNamedNotHidden(t *testing.T) {
	svc, dir := newStoreService(t)
	plugin := filepath.Join(dir, "acme-notes")
	if err := os.MkdirAll(plugin, 0o750); err != nil {
		t.Fatal(err)
	}
	for rel, body := range map[string]string{
		"manifest.json": `{"id":"acme-notes","name":"Acme notes","version":"1.0.0"}`,
		"main.js":       "export function activate() {}",
	} {
		if err := os.WriteFile(filepath.Join(plugin, rel), []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := WriteInstallRecord(plugin, InstallRecord{Source: PluginSource{Kind: "github", Repo: "acme/notes"}, Version: "1.0.0", Tier: TierUnverified}); err != nil {
		t.Fatal(err)
	}
	svc.SetDownloader(func(string, int64) ([]byte, error) { return nil, fmt.Errorf("nothing is published at that address") })
	check, err := svc.CheckForUpdates()
	if err != nil {
		t.Fatal(err)
	}
	if len(check.Candidates) != 0 || len(check.Problems) != 1 || !strings.HasPrefix(check.Problems[0], "acme-notes: ") {
		t.Fatalf("check = %+v", check)
	}
}

func TestUpdateDiscoveryRefusesRestrictedUnknownAndBlockedOriginsBeforeIO(t *testing.T) {
	for name, policy := range map[string]string{
		"legacy v1": `{"version":1,"managedBy":"Org","allowedSources":["acme/notes"]}`,
		"version 2": `{"version":2,"managedBy":"Org","sources":[{"kind":"github","locator":"acme/notes","artifactOrigins":["https://api.github.com"]}]}`,
	} {
		t.Run(name+" unknown origin", func(t *testing.T) {
			writePolicy(t, policy)
			svc, _ := newStoreService(t)
			writeInstalledUpdateFixture(t, svc, InstallRecord{Source: PluginSource{Kind: "github", Repo: "acme/notes"}})
			requests := 0
			svc.SetDownloader(func(string, int64) ([]byte, error) {
				requests++
				return []byte(`{"tag_name":"v2.0.0"}`), nil
			})
			check, err := svc.CheckForUpdates()
			if err != nil {
				t.Fatal(err)
			}
			if requests != 0 {
				t.Fatalf("requests = %d, want zero", requests)
			}
			if len(check.Problems) != 1 || !strings.Contains(check.Problems[0], "Source could not be verified") {
				t.Fatalf("problems = %v", check.Problems)
			}
		})
	}

	t.Run("blocked known folder origin", func(t *testing.T) {
		sourceDir := t.TempDir()
		allowedDir := t.TempDir()
		writePolicy(t, fmt.Sprintf(`{"version":2,"managedBy":"Org","sources":[{"kind":"path","locator":%q}]}`, allowedDir))
		svc, _ := newStoreService(t)
		writeInstalledUpdateFixture(t, svc, InstallRecord{
			Source: PluginSource{Kind: "path", Path: sourceDir},
			Origin: SourceOrigin{Kind: "path", Locator: sourceDir}, Tier: TierDev,
		})
		reads := 0
		svc.sourceRead = func(string) {
			reads++
		}
		check, err := svc.CheckForUpdates()
		if err != nil {
			t.Fatal(err)
		}
		if reads != 0 {
			t.Fatalf("source reads = %d, want zero", reads)
		}
		if len(check.Problems) != 1 || !strings.Contains(check.Problems[0], "does not allow this extension source") {
			t.Fatalf("problems = %v", check.Problems)
		}
	})
}

func TestUpdateDiscoveryKeepsUnrestrictedV1LegacyReceiptCompatibility(t *testing.T) {
	writePolicy(t, `{"version":1,"managedBy":"Org"}`)
	svc, _ := newStoreService(t)
	writeInstalledUpdateFixture(t, svc, InstallRecord{Source: PluginSource{Kind: "github", Repo: "acme/notes"}})
	requests := 0
	svc.SetDownloader(func(rawURL string, _ int64) ([]byte, error) {
		requests++
		if rawURL != LatestReleaseURL("acme/notes") {
			t.Fatalf("unexpected URL %q", rawURL)
		}
		return []byte(`{"tag_name":"v2.0.0"}`), nil
	})
	check, err := svc.CheckForUpdates()
	if err != nil || len(check.Candidates) != 1 {
		t.Fatalf("check = %+v, %v", check, err)
	}
	if requests != 1 {
		t.Fatalf("requests = %d, want one", requests)
	}
}

func TestUpdateDiscoveryAllowsRecordedFolderAndGitHubRedirect(t *testing.T) {
	t.Run("folder", func(t *testing.T) {
		sourceDir := t.TempDir()
		if err := os.WriteFile(filepath.Join(sourceDir, "manifest.json"), []byte(`{"version":"2.0.0"}`), 0o600); err != nil {
			t.Fatal(err)
		}
		writePolicy(t, fmt.Sprintf(`{"version":2,"managedBy":"Org","sources":[{"kind":"path","locator":%q}]}`, sourceDir))
		svc, _ := newStoreService(t)
		writeInstalledUpdateFixture(t, svc, InstallRecord{
			Source: PluginSource{Kind: "path", Path: sourceDir},
			Origin: SourceOrigin{Kind: "path", Locator: sourceDir}, Tier: TierDev,
		})
		reads := 0
		svc.sourceRead = func(string) {
			reads++
		}
		check, err := svc.CheckForUpdates()
		if err != nil || len(check.Candidates) != 1 || check.Candidates[0].Available != "2.0.0" {
			t.Fatalf("check = %+v, %v", check, err)
		}
		if reads != 1 {
			t.Fatalf("source reads = %d, want one", reads)
		}
	})

	t.Run("github redirect", func(t *testing.T) {
		finalRequests := 0
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			if request.URL.Path == "/start" {
				http.Redirect(writer, request, "/final", http.StatusFound)
				return
			}
			finalRequests++
			_, _ = writer.Write([]byte(`{"tag_name":"v2.0.0"}`))
		}))
		defer server.Close()
		writePolicy(t, fmt.Sprintf(`{"version":2,"managedBy":"Org","sources":[{"kind":"github","locator":"acme/notes","artifactOrigins":[%q]}]}`, server.URL))
		svc, _ := newStoreService(t)
		tag, err := svc.latestReleaseTagAt("acme/notes", server.URL+"/start", SourceOrigin{Kind: "github", Locator: "acme/notes"})
		if err != nil || tag != "v2.0.0" {
			t.Fatalf("tag = %q, %v", tag, err)
		}
		if finalRequests != 1 {
			t.Fatalf("final requests = %d, want one", finalRequests)
		}
	})
}

func TestMarketplaceUpdateRefreshRefusesChangedPolicyBeforeSourceRead(t *testing.T) {
	svc, _ := newStoreService(t)
	market := t.TempDir()
	writeFolderMarketplace(t, market, "1.0.0")
	if _, err := svc.AddMarketplaceSource(market); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.InstallFromMarketplace("fx", "fx-notes"); err != nil {
		t.Fatal(err)
	}
	writePolicy(t, fmt.Sprintf(`{"version":2,"managedBy":"Org","sources":[{"kind":"path","locator":%q}]}`, t.TempDir()))
	reads := 0
	svc.sourceRead = func(string) {
		reads++
	}
	check, err := svc.CheckForUpdates()
	if err != nil {
		t.Fatal(err)
	}
	if reads != 0 {
		t.Fatalf("source reads = %d, want zero", reads)
	}
	if joined := strings.Join(check.Problems, "\n"); !strings.Contains(joined, "does not allow this extension source") {
		t.Fatalf("problems = %v", check.Problems)
	}
}

// The persisted shape round-trips through the state file.
func TestUpdateCheck_RoundTripsThroughState(t *testing.T) {
	svc, _ := newStoreService(t)
	want := UpdateCheck{CheckedAt: "2026-01-01T00:00:00Z", Candidates: []UpdateCandidate{{ID: "a", Installed: "1.0.0", Available: "1.2.0", Tier: TierHashPinned}}, Problems: []string{}}
	_, err := svc.mutateState(func(st *marketplaceState) error {
		st.Updates = want
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	got, err := svc.ListUpdates()
	if err != nil {
		t.Fatal(err)
	}
	a, _ := json.Marshal(want)
	b, _ := json.Marshal(got)
	if string(a) != string(b) {
		t.Errorf("round trip = %s, want %s", b, a)
	}
}
