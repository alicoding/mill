package pluginsvc

import "testing"

func TestApplyMarketplaceUpdateRefusesReaddedSourceIncarnationBeforeIO(t *testing.T) {
	svc, _ := newStoreService(t)
	market := t.TempDir()
	writeFolderMarketplace(t, market, "1.0.0")
	first, err := svc.AddMarketplaceSource(market)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := installMarketplaceForTest(t, svc, "fx", "fx-notes"); err != nil {
		t.Fatal(err)
	}
	writeFolderMarketplace(t, market, "1.1.0")
	check, err := svc.CheckForUpdates()
	if err != nil || len(check.Candidates) != 1 || check.Candidates[0].Incarnation != first.Incarnation {
		t.Fatalf("check = %+v, %v", check, err)
	}
	if err := svc.RemoveMarketplaceSource(first.Name, first.Incarnation); err != nil {
		t.Fatal(err)
	}
	second, err := svc.AddMarketplaceSource(market)
	if err != nil {
		t.Fatal(err)
	}
	if second.Incarnation == first.Incarnation {
		t.Fatal("re-added source kept its old incarnation")
	}
	reads := 0
	svc.sourceRead = func(string) { reads++ }
	if _, err := updatePluginForTest(t, svc, "fx-notes"); userErrorCode(err) != "install-candidate-changed" {
		t.Fatalf("update error = %v", err)
	}
	if reads != 0 {
		t.Fatalf("source reads = %d, want zero", reads)
	}
	if got := installedVersion(t, svc, "fx-notes"); got != "1.0.0" {
		t.Fatalf("installed version = %q, want 1.0.0", got)
	}
}
