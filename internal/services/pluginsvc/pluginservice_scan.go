package pluginsvc

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// ListPlugins scans the plugins directory fresh on every call (the
// Extensions page's Rescan is just another call) and returns every
// plugin folder with its manifest -- valid ones ready to load,
// invalid ones carrying their human-readable Error.
func (p *PluginService) ListPlugins() ([]PluginInfo, error) {
	p.installMu.Lock()
	defer p.installMu.Unlock()
	if err := p.recoverInstallationsLocked(); err != nil {
		return nil, err
	}
	return p.listPluginsLocked()
}

func (p *PluginService) listPluginsLocked() ([]PluginInfo, error) {
	entries, err := os.ReadDir(p.dir)
	if err != nil && !os.IsNotExist(err) {
		return nil, fmt.Errorf("read plugins directory: %w", err)
	}
	approval, approvalErr := p.readApproval()
	infos := make([]PluginInfo, 0, len(entries))
	scanned := map[string]bool{}
	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		info := p.scanOneWithoutApproval(entry.Name())
		applyApprovalVerdict(&info, approval, approvalErr)
		infos = append(infos, info)
		scanned[entry.Name()] = true
	}
	for _, id := range builtinPluginIDs() {
		if !scanned[id] {
			infos = append(infos, scanBuiltin(id, p.appVersion))
		}
	}
	sort.Slice(infos, func(i, j int) bool { return infos[i].Manifest.ID < infos[j].Manifest.ID })
	return infos, nil
}

// resolvePlugin is the by-id lookup every non-list path uses. The user's
// folder shadows the built-in with the same id.
func (p *PluginService) resolvePlugin(id string) PluginInfo {
	p.installMu.Lock()
	defer p.installMu.Unlock()
	if err := p.recoverInstallationsLocked(); err != nil {
		return PluginInfo{Manifest: Manifest{ID: id}, Error: err.Error()}
	}
	info, _ := p.resolvePluginLocked(id)
	return info
}

func (p *PluginService) resolvePluginLocked(id string) (PluginInfo, bool) {
	if !pluginIDPattern.MatchString(id) {
		return PluginInfo{Manifest: Manifest{ID: id}, Error: "the manifest id must be lowercase letters, digits, and hyphens"}, false
	}
	if _, err := os.Stat(filepath.Join(p.dir, id)); err == nil { // #nosec G703 -- id passed pluginIDPattern above
		return p.scanOneWithoutApproval(id), true
	}
	if isBuiltinPluginID(id) {
		return scanBuiltin(id, p.appVersion), true
	}
	return p.scanOneWithoutApproval(id), false
}

func (p *PluginService) scanOne(folder string) PluginInfo {
	info := p.scanOneWithoutApproval(folder)
	approval, err := p.readApproval()
	applyApprovalVerdict(&info, approval, err)
	return info
}

func (p *PluginService) scanOneWithoutApproval(folder string) PluginInfo {
	dir := filepath.Join(p.dir, folder)
	info := PluginInfo{Dir: dir, Manifest: Manifest{ID: folder}}
	manifest, problem := readPluginManifest(dir)
	if problem != "" {
		info.Error = problem
		return info
	}
	info.Manifest = manifest
	info.Grants = pluginGrants(false, manifest)
	info.Warnings = manifestWarnings(manifest)
	dataOnly := p.validateScannedManifest(&info, dir, folder, manifest)
	addScannedHashes(&info, dir)
	info.DataOnly = info.Error == "" && dataOnly
	p.applyScannedMetadata(&info, dir, manifest)
	p.applyPolicy(&info)
	return info
}

func readPluginManifest(dir string) (Manifest, string) {
	raw, err := os.ReadFile(filepath.Join(dir, "manifest.json")) // #nosec G304,G703 -- dir is under the service plugin root
	if err != nil {
		return Manifest{}, "manifest.json is missing or unreadable"
	}
	var manifest Manifest
	if err := json.Unmarshal(raw, &manifest); err != nil {
		return Manifest{}, "manifest.json is not valid JSON"
	}
	return manifest, ""
}

func (p *PluginService) validateScannedManifest(info *PluginInfo, dir, folder string, manifest Manifest) bool {
	_, mainErr := os.Stat(filepath.Join(dir, "main.js")) // #nosec G703 -- folder came from ReadDir or passed pluginIDPattern
	info.Error = manifestProblem(manifest, folder, mainErr == nil, p.appVersion)
	dataOnly := info.Error == "" && mainErr != nil && isDataOnlyManifest(manifest)
	if dataOnly {
		info.Error = dataOnlyFolderProblem(os.DirFS(dir))
	}
	if info.Error == "" {
		info.Error = stepsFileProblem(dir, manifest)
	}
	if info.Error == "" {
		info.Error = secretsFileProblem(dir, manifest)
	}
	if info.Error == "" {
		info.Error = entryFileProblem(manifest, func(rel string) bool {
			_, err := os.Stat(filepath.Join(dir, filepath.FromSlash(rel))) // #nosec G703 -- rel passed entryPathProblem
			return err == nil
		})
	}
	return dataOnly
}

func addScannedHashes(info *PluginInfo, dir string) {
	if info.Error != "" {
		return
	}
	if hash, err := ContentHash(dir); err == nil {
		info.ContentHash = hash
	}
	if hash, err := CodeHash(dir); err == nil {
		info.CodeHash = hash
	}
}

func (p *PluginService) applyScannedMetadata(info *PluginInfo, dir string, manifest Manifest) {
	if keys := p.signingKeySet(); len(keys) > 0 {
		info.SigningPolicy = true
		info.Signed = SignatureVerified(dir, info.ContentHash, keys)
	}
	info.Tier = InstalledTier(dir, false)
	record, ok := ReadInstallRecord(dir)
	if !ok {
		return
	}
	info.Marketplace = record.Marketplace
	if info.Error == "" && record.Source.Kind == "theme-file" && record.ContentHash == info.ContentHash {
		info.ThemeImport = readThemeImportMetadata(dir, manifest, record)
	}
}
