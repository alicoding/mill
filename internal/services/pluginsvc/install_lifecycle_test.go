package pluginsvc

import (
	"fmt"
	"testing"
)

// The helpers below keep older end-to-end fixtures on the production
// reserve/prepare/confirm lifecycle without reintroducing a bound immediate
// installation method.
func installMarketplaceForTest(t *testing.T, service *PluginService, marketplace, id string) (InstallRecord, error) {
	t.Helper()
	resolved, err := service.resolveMarketplaceEntry(marketplace, id)
	if err != nil {
		return InstallRecord{}, err
	}
	result, err := prepareAndConfirmForTest(t, service, InstallCandidate{
		Kind: "marketplace", Marketplace: marketplace, Incarnation: resolved.Source.Incarnation,
		ID: id, Version: resolved.Entry.Version,
	})
	return result.Record, err
}

func installLinkForTest(t *testing.T, service *PluginService, locator string) (InstallRecord, error) {
	t.Helper()
	result, err := prepareAndConfirmForTest(t, service, InstallCandidate{Kind: "link", Locator: locator})
	return result.Record, err
}

func updatePluginForTest(t *testing.T, service *PluginService, id string) (InstallRecord, error) {
	t.Helper()
	candidate, found, err := service.updateCandidate(id)
	if err != nil {
		return InstallRecord{}, err
	}
	if !found {
		return InstallRecord{}, fmt.Errorf("no update is known for %q; check for updates first", id)
	}
	result, err := prepareAndConfirmForTest(t, service, InstallCandidate{Kind: "update", ID: id, Version: candidate.Available})
	return result.Record, err
}

func importThemeForTest(t *testing.T, service *PluginService, encoded, basename, displayName, family string) (InstallCommitResult, error) {
	t.Helper()
	return prepareAndConfirmForTest(t, service, InstallCandidate{
		Kind: "theme", Encoded: encoded, Basename: basename, DisplayName: displayName, Family: family,
	})
}

func prepareAndConfirmForTest(t *testing.T, service *PluginService, candidate InstallCandidate) (InstallCommitResult, error) {
	t.Helper()
	reservation, err := service.ReserveInstallPreparation()
	if err != nil {
		return InstallCommitResult{}, err
	}
	if _, err := service.PrepareInstall(reservation.Handle, candidate); err != nil {
		return InstallCommitResult{}, err
	}
	return service.ConfirmInstall(reservation.Handle)
}
