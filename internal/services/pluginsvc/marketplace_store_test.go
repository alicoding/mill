package pluginsvc

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
)

func TestReadHTTPResponsePreservesStatus(t *testing.T) {
	resp := &http.Response{StatusCode: http.StatusNotFound, Body: io.NopCloser(strings.NewReader("missing"))}
	_, err := readHTTPResponse(resp, maxIndexBytes)
	var statusErr *httpStatusError
	if !errors.As(err, &statusErr) || statusErr.status != http.StatusNotFound {
		t.Fatalf("error = %v, want typed 404", err)
	}
}

func TestStageRepoFallsBackOnlyForAnUnpinnedMissingReleaseAsset(t *testing.T) {
	archive := zipOf(t, map[string]string{
		"fixture/manifest.json": `{"id":"fixture","name":"Fixture","version":"1.0.0"}`,
		"fixture/main.js":       "export function activate() {}",
	})
	terminal := []struct {
		name     string
		declared string
		answer   func() ([]byte, error)
	}{
		{name: "pinned missing asset", declared: SHA256Hex(archive), answer: func() ([]byte, error) { return nil, &httpStatusError{status: http.StatusNotFound} }},
		{name: "authentication", answer: func() ([]byte, error) { return nil, &httpStatusError{status: http.StatusUnauthorized} }},
		{name: "network", answer: func() ([]byte, error) { return nil, os.ErrDeadlineExceeded }},
		{name: "digest", declared: strings.Repeat("0", 64), answer: func() ([]byte, error) { return archive, nil }},
		{name: "archive", answer: func() ([]byte, error) { return []byte("not a zip"), nil }},
	}
	for _, tc := range terminal {
		t.Run(tc.name, func(t *testing.T) {
			svc, _ := newStoreService(t)
			requests := 0
			svc.SetDownloader(func(string, int64) ([]byte, error) {
				requests++
				return tc.answer()
			})
			if _, _, err := svc.stageRepo(t.TempDir(), "acme/fixture", "main", "fixture", "1.0.0", tc.declared); err == nil {
				t.Fatal("stageRepo succeeded")
			}
			if requests != 1 {
				t.Fatalf("requests = %d, want only the release asset request", requests)
			}
		})
	}

	t.Run("policy", func(t *testing.T) {
		writePolicy(t, `{"version":2,"managedBy":"Org","sources":[{"kind":"github","locator":"other/repo","artifactOrigins":["https://github.com"]}]}`)
		svc, _ := newStoreService(t)
		requests := 0
		svc.SetDownloader(func(string, int64) ([]byte, error) {
			requests++
			return archive, nil
		})
		if _, _, err := svc.stageRepo(t.TempDir(), "acme/fixture", "main", "fixture", "1.0.0", "", SourceOrigin{Kind: "github", Locator: "acme/fixture"}); err == nil {
			t.Fatal("stageRepo succeeded")
		}
		if requests != 0 {
			t.Fatalf("requests = %d, want policy refusal before IO", requests)
		}
	})

	svc, _ := newStoreService(t)
	requests := []string{}
	svc.SetDownloader(func(rawURL string, _ int64) ([]byte, error) {
		requests = append(requests, rawURL)
		if len(requests) == 1 {
			return nil, &httpStatusError{status: http.StatusNotFound}
		}
		return archive, nil
	})
	tier, _, err := svc.stageRepo(t.TempDir(), "acme/fixture", "main", "fixture", "1.0.0", "")
	if err != nil || tier != TierUnverified {
		t.Fatalf("fallback = tier %q, error %v", tier, err)
	}
	if len(requests) != 2 || requests[1] != BranchArchiveURL("acme/fixture", "main") {
		t.Fatalf("requests = %v, want release asset then branch archive", requests)
	}
}

// exampleFS mirrors main.go's own embed layout, so the bundled
// marketplace is exercised through the same root the binary uses.
func exampleFS(ids ...string) fstest.MapFS {
	fsys := fstest.MapFS{}
	for _, id := range ids {
		base := exampleMarketplaceRoot + "/" + id
		fsys[base+"/manifest.json"] = &fstest.MapFile{Data: []byte(fmt.Sprintf(
			`{"id":%q,"name":"Example %s","version":"1.0.0","author":"Mill","description":"An example.","capabilities":["fetch"],"contributes":{"network":[{"host":"api.example.test"}]}}`, id, id))}
		fsys[base+"/main.js"] = &fstest.MapFile{Data: []byte("export function activate() {}")}
	}
	return fsys
}

func newStoreService(t *testing.T, ids ...string) (*PluginService, string) {
	t.Helper()
	dir := t.TempDir()
	svc := New(dir, nil, "")
	if len(ids) > 0 {
		svc.SetExampleMarketplace(exampleFS(ids...))
	}
	return svc, dir
}

// Browse is never empty on a fresh install: the extensions the binary
// carries are offered through the same tab as any other index.
func TestBrowseMarketplaces_ListsEveryBundledExample(t *testing.T) {
	svc, _ := newStoreService(t, "mill-alpha", "mill-beta")
	entries, err := svc.BrowseMarketplaces()
	if err != nil {
		t.Fatal(err)
	}
	if len(entries.Entries) != 2 {
		t.Fatalf("entries = %d, want 2: %+v", len(entries.Entries), entries)
	}
	for _, e := range entries.Entries {
		if e.Marketplace != ReservedMarketplaceName {
			t.Errorf("marketplace = %q, want %q", e.Marketplace, ReservedMarketplaceName)
		}
		if e.Tier != TierVerified {
			t.Errorf("%s tier = %q, want %q", e.ID, e.Tier, TierVerified)
		}
		if e.Installed {
			t.Errorf("%s reported installed on a fresh directory", e.ID)
		}
	}
}

func TestInstallFromMarketplace_CopiesABundledExampleOutOfTheBinary(t *testing.T) {
	svc, dir := newStoreService(t, "mill-alpha")
	rec, err := svc.InstallFromMarketplace(ReservedMarketplaceName, "mill-alpha")
	if err != nil {
		t.Fatalf("InstallFromMarketplace() = %v", err)
	}
	if rec.Tier != TierVerified || rec.Marketplace != ReservedMarketplaceName {
		t.Errorf("record = %+v, want a verified mill install", rec)
	}
	if _, err := os.Stat(filepath.Join(dir, "mill-alpha", "manifest.json")); err != nil {
		t.Fatalf("the plugin did not land on disk: %v", err)
	}
	infos, err := svc.ListPlugins()
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, info := range infos {
		if info.Manifest.ID != "mill-alpha" {
			continue
		}
		found = true
		if info.Error != "" {
			t.Errorf("installed plugin reports %q", info.Error)
		}
		if info.Tier != TierVerified {
			t.Errorf("scanned tier = %q, want %q", info.Tier, TierVerified)
		}
		if info.Marketplace != ReservedMarketplaceName {
			t.Errorf("scanned marketplace = %q", info.Marketplace)
		}
	}
	if !found {
		t.Fatal("the installed plugin is not in ListPlugins()")
	}
}

// A source is only added once its index actually parses -- a wrong
// address is refused while the user is still looking at the field.
func TestAddMarketplaceSource_ReadsAFolderIndexAndPersistsIt(t *testing.T) {
	svc, _ := newStoreService(t)
	market := writeFixtureMarketplace(t)
	src, err := svc.AddMarketplaceSource(market)
	if err != nil {
		t.Fatalf("AddMarketplaceSource() = %v", err)
	}
	if src.Name != "fixture" || src.Kind != "path" {
		t.Fatalf("source = %+v, want the fixture folder source", src)
	}
	sources, err := svc.ListMarketplaceSources()
	if err != nil || len(sources) != 2 {
		t.Fatalf("sources = %+v (%v), want bundled and fixture", sources, err)
	}
	entries, err := svc.BrowseMarketplaces()
	if err != nil {
		t.Fatal(err)
	}
	if !hasEntry(entries.Entries, "fixture", "fixture-notes") {
		t.Fatalf("browse = %+v, want the fixture entry", entries)
	}
}

func TestAddMarketplaceSource_RefusesTheSameNameTwice(t *testing.T) {
	svc, _ := newStoreService(t)
	market := writeFixtureMarketplace(t)
	if _, err := svc.AddMarketplaceSource(market); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.AddMarketplaceSource(market); err == nil || !strings.Contains(err.Error(), "already") {
		t.Fatalf("err = %v, want an already-added refusal", err)
	}
}

func TestRemoveMarketplaceSource_DropsItsEntriesFromBrowse(t *testing.T) {
	svc, _ := newStoreService(t)
	source, err := svc.AddMarketplaceSource(writeFixtureMarketplace(t))
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.RemoveMarketplaceSource("fixture", source.Incarnation); err != nil {
		t.Fatalf("RemoveMarketplaceSource() = %v", err)
	}
	entries, err := svc.BrowseMarketplaces()
	if err != nil {
		t.Fatal(err)
	}
	if hasEntry(entries.Entries, "fixture", "fixture-notes") {
		t.Error("the removed source's entries are still listed")
	}
	if err := svc.RemoveMarketplaceSource("fixture", source.Incarnation); err == nil {
		t.Error("removing an unknown source = nil error, want a refusal")
	}
}

func TestInstallFromMarketplace_InstallsAPathEntryFromTheSourceFolder(t *testing.T) {
	svc, dir := newStoreService(t)
	if _, err := svc.AddMarketplaceSource(writeFixtureMarketplace(t)); err != nil {
		t.Fatal(err)
	}
	pv, err := svc.PreviewInstall("fixture", "fixture-notes")
	if err != nil || pv.ID != "fixture-notes" || pv.Version != "1.0.0" {
		t.Fatalf("PreviewInstall() = %+v, %v", pv, err)
	}
	rec, err := svc.InstallFromMarketplace("fixture", "fixture-notes")
	if err != nil {
		t.Fatalf("InstallFromMarketplace() = %v", err)
	}
	if rec.Tier != TierDev {
		t.Errorf("tier = %q, want %q for a folder source", rec.Tier, TierDev)
	}
	if _, err := os.Stat(filepath.Join(dir, "fixture-notes", "main.js")); err != nil {
		t.Fatalf("the plugin did not land on disk: %v", err)
	}
}

// The declared hash is the whole point of the hash-pinned tier: bytes
// that do not match it never reach the plugins directory.
func TestInstallFromMarketplace_RefusesAnArchiveThatDoesNotMatchItsHash(t *testing.T) {
	svc, dir := newStoreService(t)
	archive := zipOf(t, map[string]string{
		"fixture-notes/manifest.json": `{"id":"fixture-notes","name":"Notes","version":"1.0.0"}`,
		"fixture-notes/main.js":       "export function activate() {}",
	})
	svc.SetDownloader(func(string, int64) ([]byte, error) { return archive, nil })
	writeSourceIndex(t, svc, `{"name":"fixture","plugins":[{"id":"fixture-notes","name":"Notes","version":"1.0.0","sha256":"0000000000000000000000000000000000000000000000000000000000000000","source":{"kind":"archive","url":"https://example.test/notes.zip"}}]}`)
	_, err := svc.InstallFromMarketplace("fixture", "fixture-notes")
	if err == nil || !strings.Contains(err.Error(), "hash the source declared") {
		t.Fatalf("err = %v, want a hash-mismatch refusal", err)
	}
	if _, statErr := os.Stat(filepath.Join(dir, "fixture-notes")); statErr == nil {
		t.Fatal("the refused download was written anyway")
	}
}

func TestInstallFromMarketplace_PinnedRepoRefusalPreservesInstalledPackageAndReceipt(t *testing.T) {
	svc, dir := newStoreService(t)
	installed := filepath.Join(dir, "fixture-notes")
	writePlugin(t, dir, "fixture-notes", `{"id":"fixture-notes","name":"Notes","version":"0.9.0"}`, nil)
	wantRecord := InstallRecord{Source: PluginSource{Kind: "github", Repo: "acme/notes"}, Version: "0.9.0", Tier: TierUnverified}
	if err := WriteInstallRecord(installed, wantRecord); err != nil {
		t.Fatal(err)
	}
	manifestBefore, err := os.ReadFile(filepath.Join(installed, "manifest.json")) // #nosec G304 -- test-owned install path
	if err != nil {
		t.Fatal(err)
	}
	receiptBefore, err := os.ReadFile(filepath.Join(installed, InstallRecordFile)) // #nosec G304 -- test-owned install path
	if err != nil {
		t.Fatal(err)
	}
	archive := zipOf(t, map[string]string{
		"fixture-notes/manifest.json": `{"id":"fixture-notes","name":"Notes","version":"1.0.0"}`,
		"fixture-notes/main.js":       "export function activate() {}",
	})
	requests := 0
	svc.SetDownloader(func(string, int64) ([]byte, error) {
		requests++
		return archive, nil
	})
	writeSourceIndex(t, svc, `{"name":"fixture","plugins":[{"id":"fixture-notes","name":"Notes","version":"1.0.0","sha256":"0000000000000000000000000000000000000000000000000000000000000000","source":{"kind":"github","repo":"acme/notes"}}]}`)
	if _, err := svc.InstallFromMarketplace("fixture", "fixture-notes"); err == nil {
		t.Fatal("pinned mismatch installed")
	}
	manifestAfter, _ := os.ReadFile(filepath.Join(installed, "manifest.json"))  // #nosec G304 -- test-owned install path
	receiptAfter, _ := os.ReadFile(filepath.Join(installed, InstallRecordFile)) // #nosec G304 -- test-owned install path
	if string(manifestAfter) != string(manifestBefore) || string(receiptAfter) != string(receiptBefore) {
		t.Fatal("refusal changed the installed package or receipt")
	}
	if requests != 1 {
		t.Fatalf("requests = %d, want no branch fallback", requests)
	}
}

func TestInstallFromMarketplace_EarnsHashPinnedWhenTheHashMatches(t *testing.T) {
	svc, _ := newStoreService(t)
	archive := zipOf(t, map[string]string{
		"fixture-notes/manifest.json": `{"id":"fixture-notes","name":"Notes","version":"1.0.0"}`,
		"fixture-notes/main.js":       "export function activate() {}",
	})
	svc.SetDownloader(func(string, int64) ([]byte, error) { return archive, nil })
	writeSourceIndex(t, svc, fmt.Sprintf(`{"name":"fixture","plugins":[{"id":"fixture-notes","name":"Notes","version":"1.0.0","sha256":%q,"source":{"kind":"archive","url":"https://example.test/notes.zip"}}]}`, SHA256Hex(archive)))
	rec, err := svc.InstallFromMarketplace("fixture", "fixture-notes")
	if err != nil {
		t.Fatalf("InstallFromMarketplace() = %v", err)
	}
	if rec.Tier != TierHashPinned {
		t.Errorf("tier = %q, want %q", rec.Tier, TierHashPinned)
	}
}

// The install prompt must be able to state what an extension can do
// before anything downloads.
// The prompt's tier and the install's recorded tier must agree, or the
// prompt asks for an acknowledgment the install never needed.
func TestBrowseMarketplaces_PromisesTheTierTheInstallWillRecord(t *testing.T) {
	svc, _ := newStoreService(t)
	if _, err := svc.AddMarketplaceSource(writeFixtureMarketplace(t)); err != nil {
		t.Fatal(err)
	}
	entries, err := svc.BrowseMarketplaces()
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries.Entries {
		if e.Marketplace == "fixture" && e.Tier != TierDev {
			t.Fatalf("browse tier = %q, want %q for a folder entry", e.Tier, TierDev)
		}
	}
	rec, err := svc.InstallFromMarketplace("fixture", "fixture-notes")
	if err != nil {
		t.Fatal(err)
	}
	if rec.Tier != TierDev {
		t.Errorf("installed tier = %q, want %q", rec.Tier, TierDev)
	}
}

func TestPreviewInstall_ReportsWhatTheExtensionCanDo(t *testing.T) {
	svc, _ := newStoreService(t, "mill-alpha")
	pv, err := svc.PreviewInstall(ReservedMarketplaceName, "mill-alpha")
	if err != nil {
		t.Fatal(err)
	}
	if len(pv.Capabilities) != 1 || pv.Capabilities[0] != "fetch" {
		t.Errorf("capabilities = %v, want [fetch]", pv.Capabilities)
	}
	if len(pv.NetworkHosts) != 1 || pv.NetworkHosts[0] != "api.example.test" {
		t.Errorf("hosts = %v, want [api.example.test]", pv.NetworkHosts)
	}
	if pv.Tier != TierVerified || pv.AlreadyInstalled {
		t.Errorf("preview = %+v, want a verified, not-yet-installed entry", pv)
	}
	if len(pv.Kinds) == 0 {
		t.Error("kinds are empty, want the families the manifest fills")
	}
}

func TestPreviewInstalled_AnswersTheSameListForAnInstalledPlugin(t *testing.T) {
	svc, _ := newStoreService(t, "mill-alpha")
	if _, err := svc.InstallFromMarketplace(ReservedMarketplaceName, "mill-alpha"); err != nil {
		t.Fatal(err)
	}
	pv, err := svc.PreviewInstalled("mill-alpha")
	if err != nil {
		t.Fatal(err)
	}
	if pv.Tier != TierVerified || len(pv.NetworkHosts) != 1 {
		t.Errorf("preview = %+v, want the installed plugin's verified reach", pv)
	}
}

func TestContributionKindNames_IsTheManifestsOwnVocabulary(t *testing.T) {
	names := ContributionKindNames()
	for _, want := range []string{"canvasObjects", "steps", "views", "themes", "tools"} {
		found := false
		for _, n := range names {
			if n == want {
				found = true
			}
		}
		if !found {
			t.Errorf("%q missing from %v", want, names)
		}
	}
}

func hasEntry(entries []BrowseEntry, marketplace, id string) bool {
	for _, e := range entries {
		if e.Marketplace == marketplace && e.ID == id {
			return true
		}
	}
	return false
}

// writeFixtureMarketplace builds a folder marketplace with one path
// plugin in it and answers its root.
func writeFixtureMarketplace(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	index := `{
		"name": "fixture",
		"owner": { "name": "Fixture" },
		"plugins": [ { "id": "fixture-notes", "name": "Fixture notes", "version": "1.0.0", "source": { "kind": "path", "path": "fixture-notes" } } ]
	}`
	if err := os.MkdirAll(filepath.Join(root, ".mill"), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".mill", "marketplace.json"), []byte(index), 0o600); err != nil {
		t.Fatal(err)
	}
	writePlugin(t, root, "fixture-notes", `{"id":"fixture-notes","name":"Fixture notes","version":"1.0.0"}`, nil)
	return root
}

// writeSourceIndex seeds a cached index directly, for the archive
// paths where the source's own transport is not what is under test.
func writeSourceIndex(t *testing.T, svc *PluginService, index string) {
	t.Helper()
	parsed, err := ParseIndex([]byte(index))
	if err != nil {
		t.Fatal(err)
	}
	source, err := canonicalSource(MarketplaceSource{Name: parsed.Name, Kind: "url", Locator: "https://example.test/" + IndexFile})
	if err != nil {
		t.Fatal(err)
	}
	source.Incarnation, _ = freshIncarnation()
	source.Status = SourceCurrent
	_, err = svc.mutateState(func(st *marketplaceState) error {
		st.Sources = append(st.Sources, source)
		st.Indexes[parsed.Name] = marketplaceIndexCache{Incarnation: source.Incarnation, Origin: source.Origin, Index: parsed}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
