package pluginsvc

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/alicoding/mill/internal/domain/usererror"
)

// finishInstall preserves the existing reinstall behavior. Every install
// mode shares installMu so a no-replace theme snapshot cannot race a normal
// install targeting the same plugin id.
func (p *PluginService) finishInstall(stage string, rec InstallRecord) (InstallRecord, error) {
	return p.finishInstallMode(stage, rec, true, nil)
}

func (p *PluginService) finishThemeInstall(stage string, rec InstallRecord) (InstallRecord, error) {
	return p.finishInstallMode(stage, rec, false, nil)
}

func (p *PluginService) finishMarketplaceInstall(stage string, rec InstallRecord, source MarketplaceSource) (InstallRecord, error) {
	return p.finishInstallMode(stage, rec, true, &source)
}

func (p *PluginService) finishInstallMode(stage string, rec InstallRecord, replace bool, expectedSource *MarketplaceSource) (InstallRecord, error) {
	return p.finishInstallModeWith(stage, rec, replace, expectedSource, installFinalizationDeps{})
}

type installFinalizationDeps struct {
	beforePolicyRecheck func() error
}

func (p *PluginService) finishInstallModeWith(stage string, rec InstallRecord, replace bool, expectedSource *MarketplaceSource, deps installFinalizationDeps) (InstallRecord, error) {
	p.installMu.Lock()
	defer p.installMu.Unlock()
	if err := p.validateMarketplaceSourceIdentity(expectedSource); err != nil {
		return InstallRecord{}, err
	}
	id, root, err := ManifestIDIn(stage)
	if err != nil {
		return InstallRecord{}, err
	}
	warnings, err := p.stagedChecks(root, rec)
	if err != nil {
		return InstallRecord{}, err
	}
	rec.Warnings = warnings
	if err := os.MkdirAll(p.dir, 0o750); err != nil {
		return InstallRecord{}, err
	}
	target := filepath.Join(p.dir, id) // #nosec G703 -- id passed pluginIDPattern inside ManifestIDIn
	if !replace && p.installedFolderExists(id) {
		return InstallRecord{}, usererror.New("theme-import-duplicate", "This theme is already imported. Remove it from Extensions before importing it again.")
	}
	if existing := p.scanOne(id); replace && p.installedFolderExists(id) && existing.Manifest.ID != "" && existing.Manifest.ID != id {
		return InstallRecord{}, fmt.Errorf("a different extension is already installed at %q", id)
	}
	if err := p.validateMarketplaceSourceIdentity(expectedSource); err != nil {
		return InstallRecord{}, err
	}
	if deps.beforePolicyRecheck != nil {
		if err := deps.beforePolicyRecheck(); err != nil {
			return InstallRecord{}, err
		}
	}
	if err := recheckStagedPolicy(root, rec); err != nil {
		return InstallRecord{}, err
	}
	if err := placeInstalledFolder(root, target, replace); err != nil {
		return InstallRecord{}, err
	}
	return p.recordInstalledPlugin(target, id, rec, replace)
}

func (p *PluginService) validateMarketplaceSourceIdentity(expected *MarketplaceSource) error {
	if expected == nil || expected.Kind == "bundled" {
		return nil
	}
	current, found, err := p.sourceFor(expected.Name)
	if err != nil {
		return err
	}
	if !found || current.Incarnation != expected.Incarnation || current.Origin != expected.Origin {
		return fmt.Errorf("%q is no longer the registered source used for this installation", expected.Name)
	}
	return nil
}

func placeInstalledFolder(root, target string, replace bool) error {
	if err := os.RemoveAll(target); err != nil {
		return err
	}
	if err := os.Rename(root, target); err != nil {
		if copyErr := CopyPluginFolder(root, target); copyErr != nil {
			if !replace {
				_ = os.RemoveAll(target)
			}
			return copyErr
		}
	}
	return nil
}

func (p *PluginService) recordInstalledPlugin(target, id string, rec InstallRecord, replace bool) (InstallRecord, error) {
	info := p.scanOne(id)
	if info.Error != "" {
		_ = os.RemoveAll(target)
		return InstallRecord{}, fmt.Errorf("%s", info.Error)
	}
	rec.Version = info.Manifest.Version
	rec.ContentHash = info.ContentHash
	rec.InstalledAt = time.Now().UTC().Format(time.RFC3339)
	if rec.Tier == TierVerified && !p.signatureOK(target, info.ContentHash) && rec.Marketplace != ReservedMarketplaceName {
		rec.Tier = TierHashPinned
	}
	if err := WriteInstallRecord(target, rec); err != nil {
		if !replace {
			_ = os.RemoveAll(target)
		}
		return InstallRecord{}, err
	}
	return rec, nil
}
