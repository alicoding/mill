package pluginsvc

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
)

// exampleFS mirrors main.go's own embed layout, so the bundled
// marketplace is exercised through the same root the binary uses.
func exampleFS(ids ...string) fstest.MapFS {
	fsys := fstest.MapFS{}
	for _, id := range ids {
		base := exampleMarketplaceRoot + "/" + id
		fsys[base+"/manifest.json"] = &fstest.MapFile{Data: []byte(fmt.Sprintf(
			`{"id":%q,"name":"Example %s","version":"1.0.0","author":"Mill","description":"An example.","capabilities":["fetch"],"contributes":{"network":[{"host":"api.example.test"}],"views":[{"id":"v","title":"V"}]}}`, id, id))}
		fsys[base+"/main.js"] = &fstest.MapFile{Data: []byte("export function activate() {}")}
	}
	return fsys
}

func newStoreService(t *testing.T, ids ...string) (*PluginService, string) {
	t.Helper()
	dir := t.TempDir()
	svc := New(dir, nil, "")
	svc.SetExampleMarketplace(exampleFS(ids...))
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
	if len(entries) != 2 {
		t.Fatalf("entries = %d, want 2: %+v", len(entries), entries)
	}
	for _, e := range entries {
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
	if err != nil || len(sources) != 1 {
		t.Fatalf("sources = %+v (%v), want one", sources, err)
	}
	entries, err := svc.BrowseMarketplaces()
	if err != nil {
		t.Fatal(err)
	}
	if !hasEntry(entries, "fixture", "fixture-notes") {
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
	if _, err := svc.AddMarketplaceSource(writeFixtureMarketplace(t)); err != nil {
		t.Fatal(err)
	}
	if err := svc.RemoveMarketplaceSource("fixture"); err != nil {
		t.Fatalf("RemoveMarketplaceSource() = %v", err)
	}
	entries, err := svc.BrowseMarketplaces()
	if err != nil {
		t.Fatal(err)
	}
	if hasEntry(entries, "fixture", "fixture-notes") {
		t.Error("the removed source's entries are still listed")
	}
	if err := svc.RemoveMarketplaceSource("fixture"); err == nil {
		t.Error("removing an unknown source = nil error, want a refusal")
	}
}

func TestInstallFromMarketplace_InstallsAPathEntryFromTheSourceFolder(t *testing.T) {
	svc, dir := newStoreService(t)
	if _, err := svc.AddMarketplaceSource(writeFixtureMarketplace(t)); err != nil {
		t.Fatal(err)
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
	st := svc.readState()
	st.Sources = append(st.Sources, MarketplaceSource{Name: parsed.Name, Kind: "url", Locator: "https://example.test/" + IndexFile})
	st.Indexes[parsed.Name] = parsed
	if err := svc.writeState(st); err != nil {
		t.Fatal(err)
	}
}
