package pluginsvc

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBrowseFolderSourceUsesOnlyItsLastAcceptedCache(t *testing.T) {
	allowed := t.TempDir()
	market := filepath.Join(allowed, "market")
	writeFolderMarketplace(t, market, "1.0.0")
	policyBody := fmt.Sprintf(`{"version":2,"managedBy":"Org","sources":[{"kind":"path","locator":%q}]}`, allowed)
	writePolicy(t, policyBody)

	svc, _ := newStoreService(t)
	source, err := svc.AddMarketplaceSource(market)
	if err != nil {
		t.Fatal(err)
	}
	attempts := 0
	svc.sourceRead = func(string) { attempts++ }

	assertCached := func(stage string) {
		t.Helper()
		before := attempts
		result, browseErr := svc.BrowseMarketplaces()
		if browseErr != nil || !hasEntry(result.Entries, "fx", "fx-notes") {
			t.Fatalf("%s Browse = %+v, %v", stage, result, browseErr)
		}
		if attempts != before {
			t.Fatalf("%s acquisition attempts = %d, want %d", stage, attempts, before)
		}
	}

	assertCached("accepted source")
	if err := os.WriteFile(filepath.Join(market, "fx-notes", "manifest.json"), []byte(`{"version":"9.0.0"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	assertCached("changed package")

	if err := os.RemoveAll(allowed); err != nil {
		t.Fatal(err)
	}
	writePolicy(t, policyBody)
	problems, err := svc.RefreshMarketplaceSources()
	if err != nil || len(problems) != 1 {
		t.Fatalf("missing Refresh = %v, %v", problems, err)
	}
	if attempts != 1 {
		sources, _ := svc.ListMarketplaceSources()
		t.Fatalf("missing source acquisition attempts = %d, want 1; problems = %v; sources = %+v", attempts, problems, sources)
	}
	sources, err := svc.ListMarketplaceSources()
	if err != nil || len(sources) != 2 || sources[1].Status != SourceUnavailable {
		t.Fatalf("missing sources = %+v, %v", sources, err)
	}
	assertCached("missing source")
	assertCached("local retry")

	writeFolderMarketplace(t, market, "1.1.0")
	if problems, err = svc.RefreshMarketplaceSources(); err != nil || len(problems) != 0 {
		t.Fatalf("recovered Refresh = %v, %v", problems, err)
	}
	sources, _ = svc.ListMarketplaceSources()
	if sources[1].Status != SourceCurrent {
		t.Fatalf("recovered source = %+v", sources[1])
	}

	if err := os.RemoveAll(market); err != nil {
		t.Fatal(err)
	}
	escape := t.TempDir()
	writeFolderMarketplace(t, escape, "99.0.0")
	if err := os.Symlink(escape, market); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	attempts = 0
	raw, readErr := svc.readSourceFile(source.Origin, IndexFile)
	if readErr == nil || len(raw) != 0 {
		t.Fatalf("escaped read = %q, %v", raw, readErr)
	}
	if attempts != 1 {
		t.Fatalf("escaped source acquisition attempts = %d, want 1", attempts)
	}
	if problems, err = svc.RefreshMarketplaceSources(); err != nil || len(problems) != 1 {
		t.Fatalf("escaped Refresh = %v, %v", problems, err)
	}
	assertCached("escaped source")
}

func TestPreviewRefusesChangedPathPolicyBeforeAcquisition(t *testing.T) {
	market := writeFixtureMarketplace(t)
	svc, _ := newStoreService(t)
	if _, err := svc.AddMarketplaceSource(market); err != nil {
		t.Fatal(err)
	}
	writePolicy(t, fmt.Sprintf(`{"version":2,"managedBy":"Org","sources":[{"kind":"path","locator":%q}]}`, t.TempDir()))
	attempts := 0
	svc.sourceRead = func(string) { attempts++ }
	pv, err := svc.PreviewInstall("fixture", "fixture-notes")
	if err != nil || !strings.Contains(pv.PolicyRefusal, "does not allow this extension source") {
		t.Fatalf("PreviewInstall = %+v, %v", pv, err)
	}
	if attempts != 0 {
		t.Fatalf("policy-refused acquisition attempts = %d, want zero", attempts)
	}
}

func TestPreviewAndInstallRefusePathPackageSymlinkEscape(t *testing.T) {
	allowed := t.TempDir()
	market := filepath.Join(allowed, "market")
	writeFolderMarketplace(t, market, "1.0.0")
	writePolicy(t, fmt.Sprintf(`{"version":2,"managedBy":"Org","sources":[{"kind":"path","locator":%q}]}`, allowed))
	svc, installDir := newStoreService(t)
	if _, err := svc.AddMarketplaceSource(market); err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(filepath.Join(market, "fx-notes")); err != nil {
		t.Fatal(err)
	}
	escape := t.TempDir()
	writePlugin(t, escape, "fx-notes", `{"id":"fx-notes","name":"Outside","version":"99.0.0"}`, nil)
	if err := os.Symlink(filepath.Join(escape, "fx-notes"), filepath.Join(market, "fx-notes")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	attempts := 0
	svc.sourceRead = func(string) { attempts++ }
	if _, err := svc.PreviewInstall("fx", "fx-notes"); err == nil {
		t.Fatal("PreviewInstall read a package outside the allowed root")
	}
	if _, err := installMarketplaceForTest(t, svc, "fx", "fx-notes"); err == nil {
		t.Fatal("InstallFromMarketplace copied a package outside the allowed root")
	}
	if attempts != 2 {
		t.Fatalf("acquisition attempts = %d, want preview and install", attempts)
	}
	if _, err := os.Stat(filepath.Join(installDir, "fx-notes")); !os.IsNotExist(err) {
		t.Fatalf("escaped package reached install directory: %v", err)
	}
}
