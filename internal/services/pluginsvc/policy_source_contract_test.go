package pluginsvc

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLegacyPolicyRuntimeUsesReceiptEvidence(t *testing.T) {
	policyPath := filepath.Join(t.TempDir(), "plugin-policy.json")
	t.Setenv(PolicyPathEnv, policyPath)
	svc, dir := newStoreService(t, "mill-alpha")
	if _, err := installMarketplaceForTest(t, svc, ReservedMarketplaceName, "mill-alpha"); err != nil {
		t.Fatal(err)
	}
	write := func(body string) {
		t.Helper()
		if err := os.WriteFile(policyPath, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	write(`{"version":1,"managedBy":"Org","allowedSources":["mill"]}`)
	if !svc.PolicyAllows("mill-alpha") {
		t.Fatal("receipt-recorded marketplace was refused")
	}
	write(`{"version":1,"managedBy":"Org","allowedSources":["other"]}`)
	if svc.PolicyAllows("mill-alpha") {
		t.Fatal("changed restrictive source policy did not block execution")
	}

	direct := filepath.Join(dir, "direct")
	writePlugin(t, dir, "direct", `{"id":"direct","name":"Direct","version":"1.0.0"}`, nil)
	if err := WriteInstallRecord(direct, InstallRecord{Source: PluginSource{Kind: "github", Repo: "acme/direct"}, Tier: TierUnverified}); err != nil {
		t.Fatal(err)
	}
	write(`{"version":1,"managedBy":"Org","allowedSources":["acme/direct"]}`)
	if !svc.PolicyAllows("direct") {
		t.Fatal("explicit legacy receipt source was refused")
	}

	writePlugin(t, dir, "unknown", `{"id":"unknown","name":"Unknown","version":"1.0.0"}`, nil)
	if svc.PolicyAllows("unknown") {
		t.Fatal("restrictive legacy policy admitted a plugin without receipt evidence")
	}
}

func TestLegacyPolicyRefusesCachedMarketplaceBeforeSourceAcquisition(t *testing.T) {
	svc, _ := newStoreService(t)
	if _, err := svc.AddMarketplaceSource(writeFixtureMarketplace(t)); err != nil {
		t.Fatal(err)
	}
	writePolicy(t, `{"version":1,"managedBy":"Org","allowedSources":["other"]}`)
	reads := 0
	svc.sourceRead = func(string) { reads++ }
	pv, err := svc.PreviewInstall("fixture", "fixture-notes")
	if err != nil || !strings.Contains(pv.PolicyRefusal, "allows installs only") {
		t.Fatalf("preview = %+v, %v", pv, err)
	}
	if _, err := installMarketplaceForTest(t, svc, "fixture", "fixture-notes"); err == nil {
		t.Fatal("restricted source installed")
	}
	if reads != 0 {
		t.Fatalf("source acquisition attempts = %d, want zero", reads)
	}
}

func TestThemeImportRecordsAndEnforcesThemeFileOrigin(t *testing.T) {
	raw := []byte(`{"colors":{"foreground":"#123456"}}`)
	t.Run("allowed and retained at runtime", func(t *testing.T) {
		writePolicy(t, `{"version":2,"managedBy":"Org","sources":[{"kind":"theme-file"}]}`)
		svc, dir := newStoreService(t)
		result, err := importThemeForTest(t, svc, encodedTheme(raw), "source.json", "Source theme", "dark")
		if err != nil {
			t.Fatal(err)
		}
		rec, ok := ReadInstallRecord(filepath.Join(dir, result.PluginID))
		if !ok || rec.Origin != (SourceOrigin{Kind: "theme-file"}) {
			t.Fatalf("receipt = %+v, present %v", rec, ok)
		}
		if !svc.PolicyAllows(result.PluginID) {
			t.Fatal("allowed imported theme was refused after restart scan")
		}
	})

	for name, policy := range map[string]string{
		"different source": `{"version":2,"managedBy":"Org","sources":[{"kind":"bundled"}]}`,
		"empty sources":    `{"version":2,"managedBy":"Org","sources":[]}`,
		"required tier":    `{"version":2,"managedBy":"Org","sources":[{"kind":"theme-file"}],"requiredTier":"verified"}`,
	} {
		t.Run(name+" refuses before files", func(t *testing.T) {
			writePolicy(t, policy)
			svc, dir := newStoreService(t)
			if _, err := importThemeForTest(t, svc, encodedTheme(raw), "source.json", "Source theme", "dark"); err == nil {
				t.Fatal("theme import succeeded")
			}
			entries, err := os.ReadDir(dir)
			if err != nil && !os.IsNotExist(err) {
				t.Fatal(err)
			}
			if len(entries) != 0 {
				t.Fatalf("refusal left files: %v", entries)
			}
		})
	}
}

func TestMarketplaceInstallRefusesSourceIdentityReplacementAfterStaging(t *testing.T) {
	svc, dir := newStoreService(t)
	firstRoot := writeFixtureMarketplace(t)
	first, err := svc.AddMarketplaceSource(firstRoot)
	if err != nil {
		t.Fatal(err)
	}
	installed := filepath.Join(dir, "fixture-notes")
	writePlugin(t, dir, "fixture-notes", `{"id":"fixture-notes","name":"Old","version":"0.9.0"}`, nil)
	if err := WriteInstallRecord(installed, InstallRecord{Source: PluginSource{Kind: "github", Repo: "old/plugin"}, Tier: TierUnverified}); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(filepath.Join(installed, "manifest.json")) // #nosec G304 -- test-owned path
	if err != nil {
		t.Fatal(err)
	}
	secondRoot := writeFixtureMarketplace(t)
	second, err := canonicalSource(MarketplaceSource{Name: first.Name, Kind: "path", Locator: secondRoot})
	if err != nil {
		t.Fatal(err)
	}
	second.Name, second.Status = first.Name, SourceCurrent
	second.Incarnation, _ = freshIncarnation()
	replaced := false
	var mutationErr error
	svc.sourceRead = func(string) {
		if replaced {
			return
		}
		replaced = true
		_, mutationErr = svc.mutateState(func(st *marketplaceState) error {
			cache := st.Indexes[first.Name]
			st.Sources[0] = second
			cache.Incarnation, cache.Origin = second.Incarnation, second.Origin
			st.Indexes[first.Name] = cache
			return nil
		})
	}
	if _, err := installMarketplaceForTest(t, svc, first.Name, "fixture-notes"); err == nil || !strings.Contains(err.Error(), "registered source used") {
		t.Fatalf("install error = %v", err)
	}
	if mutationErr != nil {
		t.Fatal(mutationErr)
	}
	after, _ := os.ReadFile(filepath.Join(installed, "manifest.json")) // #nosec G304 -- test-owned path
	if string(after) != string(before) {
		t.Fatal("identity refusal replaced the installed plugin")
	}
}

func TestMarketplaceInstallPropagatesStructuralFailureAtFinalIdentityLookup(t *testing.T) {
	svc, dir := newStoreService(t)
	if _, err := svc.AddMarketplaceSource(writeFixtureMarketplace(t)); err != nil {
		t.Fatal(err)
	}
	closed := false
	svc.sourceRead = func(string) {
		if closed {
			return
		}
		closed = true
		if err := svc.state.Close(); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := installMarketplaceForTest(t, svc, "fixture", "fixture-notes"); err == nil || userErrorCode(err) != "install-recovery-required" || errors.Unwrap(err) == nil || !strings.Contains(errors.Unwrap(err).Error(), "closed") {
		t.Fatalf("install error = %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "fixture-notes")); !os.IsNotExist(err) {
		t.Fatalf("structural refusal left an installed folder: %v", err)
	}
}

func TestMarketplaceResolutionDistinguishesCatalogFailureFromMissingSource(t *testing.T) {
	svc, dir := newStoreService(t)
	if err := os.WriteFile(filepath.Join(dir, marketplacesFile), []byte(`{"sources":`), 0o600); err != nil {
		t.Fatal(err)
	}
	for name, call := range map[string]func() error{
		"preview": func() error { _, err := svc.PreviewInstall("fixture", "fixture-notes"); return err },
		"install": func() error { _, err := installMarketplaceForTest(t, svc, "fixture", "fixture-notes"); return err },
	} {
		t.Run(name, func(t *testing.T) {
			if err := call(); err == nil || !strings.Contains(err.Error(), "not valid JSON") {
				t.Fatalf("error = %v", err)
			}
		})
	}
	clean, _ := newStoreService(t)
	if _, err := clean.PreviewInstall("fixture", "fixture-notes"); err == nil || !strings.Contains(err.Error(), "registered source") {
		t.Fatalf("missing source error = %v", err)
	}
}
