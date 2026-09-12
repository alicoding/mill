package pluginsvc

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMarketplaceStateReadDoesNotCreateFiles(t *testing.T) {
	svc, dir := newStoreService(t)
	sources, err := svc.ListMarketplaceSources()
	if err != nil || len(sources) != 1 || !sources[0].Included {
		t.Fatalf("sources = %+v, %v", sources, err)
	}
	for _, name := range []string{marketplacesFile, ".plugin-state.sqlite"} {
		if _, err := os.Stat(filepath.Join(dir, name)); !os.IsNotExist(err) {
			t.Fatalf("read created %s: %v", name, err)
		}
	}
}

func TestMarketplaceStateMigratesLegacyExactlyOnceAndPreservesEvidence(t *testing.T) {
	dir := t.TempDir()
	legacyPath := filepath.Join(dir, marketplacesFile)
	legacy := []byte(`{
  "sources": [{"name":"legacy","kind":"path","locator":"` + filepath.ToSlash(dir) + `","addedAt":"2025-01-01T00:00:00Z"}],
  "indexes": {"legacy":{"name":"legacy","owner":{"name":"Legacy owner"},"plugins":[]}},
  "updates":{"checkedAt":"2025-02-02T00:00:00Z","candidates":[],"problems":["offline"]}
}`)
	if err := os.WriteFile(legacyPath, legacy, 0o600); err != nil {
		t.Fatal(err)
	}
	svc := New(dir, nil, "")
	closeTestPluginState(t, svc)
	before, err := svc.readState()
	if err != nil || before.Updates.CheckedAt == "" || len(before.Sources) != 1 || before.Sources[0].LastSuccessAt != "" {
		t.Fatalf("legacy read = %+v, %v", before, err)
	}
	if _, err := os.Stat(filepath.Join(dir, ".plugin-state.sqlite")); !os.IsNotExist(err) {
		t.Fatalf("legacy read created database: %v", err)
	}
	_, err = svc.mutateState(func(state *marketplaceState) error {
		state.Updates.Problems = append(state.Updates.Problems, "retained")
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	retained, err := os.ReadFile(legacyPath) // #nosec G304 -- test-owned temporary profile path
	if err != nil || string(retained) != string(legacy) {
		t.Fatalf("legacy evidence changed: %v", err)
	}
	if err := os.WriteFile(legacyPath, []byte("corrupt after migration"), 0o600); err != nil {
		t.Fatal(err)
	}
	after, err := svc.readState()
	if err != nil || len(after.Updates.Problems) != 2 || after.Sources[0].Incarnation != before.Sources[0].Incarnation {
		t.Fatalf("database read = %+v, %v", after, err)
	}
}

func TestMarketplaceStateRefusesMalformedAndVersionedLegacyWithoutMigration(t *testing.T) {
	for name, body := range map[string]string{
		"malformed": `{`,
		"versioned": `{"version":1,"sources":[]}`,
	} {
		t.Run(name, func(t *testing.T) {
			dir := t.TempDir()
			path := filepath.Join(dir, marketplacesFile)
			if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
				t.Fatal(err)
			}
			svc := New(dir, nil, "")
			closeTestPluginState(t, svc)
			if _, err := svc.readState(); err == nil {
				t.Fatal("readState succeeded")
			}
			if _, err := svc.mutateState(func(*marketplaceState) error { return nil }); err == nil {
				t.Fatal("mutateState succeeded")
			}
			if _, _, present, _ := svc.state.Load(t.Context()); present {
				t.Fatal("failed migration published catalog state")
			}
			retained, _ := os.ReadFile(path) // #nosec G304 -- test-owned temporary profile path
			if string(retained) != body {
				t.Fatal("failed migration changed legacy evidence")
			}
		})
	}
}

func TestMarketplaceStateFailedFirstMutationCanRetryPreparedLegacy(t *testing.T) {
	dir := t.TempDir()
	legacy := `{"sources":[],"updates":{"problems":["kept"]}}`
	if err := os.WriteFile(filepath.Join(dir, marketplacesFile), []byte(legacy), 0o600); err != nil {
		t.Fatal(err)
	}
	svc := New(dir, nil, "")
	closeTestPluginState(t, svc)
	if _, err := svc.mutateState(func(*marketplaceState) error { return os.ErrPermission }); err == nil {
		t.Fatal("failed mutation succeeded")
	}
	if _, _, present, err := svc.state.Load(t.Context()); err != nil || present {
		t.Fatalf("failed mutation state present=%v err=%v", present, err)
	}
	state, err := svc.mutateState(func(state *marketplaceState) error {
		state.Updates.CheckedAt = "now"
		return nil
	})
	if err != nil || len(state.Updates.Problems) != 1 {
		t.Fatalf("retry = %+v, %v", state, err)
	}
}

func TestMarketplaceRemoveReaddUsesNewIdentityAndRejectsStaleConfirmation(t *testing.T) {
	svc, _ := newStoreService(t)
	first, err := svc.AddMarketplaceSource(writeFixtureMarketplace(t))
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.RemoveMarketplaceSource(first.Name, first.Incarnation); err != nil {
		t.Fatal(err)
	}
	second, err := svc.AddMarketplaceSource(writeFixtureMarketplace(t))
	if err != nil {
		t.Fatal(err)
	}
	if first.Incarnation == second.Incarnation {
		t.Fatal("remove/re-add reused incarnation")
	}
	if err := svc.RemoveMarketplaceSource(second.Name, first.Incarnation); err == nil || !strings.Contains(err.Error(), "changed") {
		t.Fatalf("stale remove error = %v", err)
	}
	sources, _ := svc.ListMarketplaceSources()
	if len(sources) != 2 || sources[1].Incarnation != second.Incarnation {
		t.Fatalf("new source was removed: %+v", sources)
	}
}

func TestMarketplaceRefreshDiscardedAfterRemoveAndReadd(t *testing.T) {
	svc, _ := newStoreService(t)
	index := `{"name":"fixture","owner":{"name":"First"},"plugins":[]}`
	svc.SetDownloader(func(string, int64) ([]byte, error) { return []byte(index), nil })
	first, err := svc.AddMarketplaceSource("https://example.test/.mill/marketplace.json")
	if err != nil {
		t.Fatal(err)
	}
	started, release := make(chan struct{}), make(chan struct{})
	svc.SetDownloader(func(string, int64) ([]byte, error) {
		close(started)
		<-release
		return []byte(`{"name":"fixture","owner":{"name":"Stale"},"plugins":[]}`), nil
	})
	finished := make(chan error, 1)
	go func() {
		_, err := svc.RefreshMarketplaceSources()
		finished <- err
	}()
	<-started
	if err := svc.RemoveMarketplaceSource(first.Name, first.Incarnation); err != nil {
		t.Fatal(err)
	}
	secondIndex := `{"name":"fixture","owner":{"name":"Second"},"plugins":[]}`
	svc.SetDownloader(func(string, int64) ([]byte, error) { return []byte(secondIndex), nil })
	second, err := svc.AddMarketplaceSource("https://second.example.test/.mill/marketplace.json")
	if err != nil {
		t.Fatal(err)
	}
	close(release)
	if err := <-finished; err != nil {
		t.Fatal(err)
	}
	sources, _ := svc.ListMarketplaceSources()
	if len(sources) != 2 || sources[1].Incarnation != second.Incarnation || sources[1].Owner != "Second" {
		t.Fatalf("stale refresh changed new source: %+v", sources)
	}
}

func TestMarketplaceFailedRefreshPreservesLastGoodCacheAndTime(t *testing.T) {
	svc, _ := newStoreService(t)
	svc.SetDownloader(func(string, int64) ([]byte, error) {
		return []byte(`{"name":"fixture","owner":{"name":"Good"},"plugins":[{"id":"good","name":"Good","source":{"kind":"archive","url":"https://example.test/good.zip"}}]}`), nil
	})
	source, err := svc.AddMarketplaceSource("https://example.test/.mill/marketplace.json")
	if err != nil {
		t.Fatal(err)
	}
	svc.SetDownloader(func(string, int64) ([]byte, error) { return nil, os.ErrDeadlineExceeded })
	problems, err := svc.RefreshMarketplaceSources()
	if err != nil || len(problems) != 1 {
		t.Fatalf("Refresh = %v, %v", problems, err)
	}
	result, err := svc.BrowseMarketplaces()
	if err != nil || !hasEntry(result.Entries, "fixture", "good") {
		t.Fatalf("Browse = %+v, %v", result, err)
	}
	updated := result.Sources[1]
	if updated.Status != SourceUnavailable || updated.LastSuccessAt != source.LastSuccessAt || updated.LastAttemptAt == "" {
		t.Fatalf("failed source status = %+v", updated)
	}
}

func TestMarketplaceStateRejectsOrphanedCache(t *testing.T) {
	state := emptyMarketplaceState()
	state.Indexes["orphan"] = marketplaceIndexCache{Index: MarketplaceIndex{Name: "orphan"}}
	payload, _ := jsonMarshalWithoutValidation(state)
	if _, err := decodeMarketplaceState(payload); err == nil || !strings.Contains(err.Error(), "inconsistent cache") {
		t.Fatalf("decode error = %v", err)
	}
}

func jsonMarshalWithoutValidation(value any) ([]byte, error) {
	return json.Marshal(value)
}
