package pluginsvc

import (
	"io/fs"
	"os"
	"path"
	"path/filepath"
)

// The two documents an extension's detail reads (docs/goals/0349): the
// overview and the changelog an author ships beside the manifest. Not
// served over the asset route -- markdown is not in that route's
// allowlist and must not become one, because the route feeds the
// webview directly. This door returns TEXT to the host, which renders
// it through the same sandboxed markdown view every other output takes.

// maxDocBytes caps a document read; an overview is prose, and anything
// larger is not one.
const maxDocBytes = 512 << 10

// PluginDocName is one of the two documents a detail tab reads.
type PluginDocName string

const (
	PluginDocOverview  PluginDocName = "README.md"
	PluginDocChangelog PluginDocName = "CHANGELOG.md"
)

// ReadPluginDoc returns an installed plugin's overview or changelog,
// or "" when it ships neither -- an absent document is a normal state
// the tab states in words, never an error.
func (p *PluginService) ReadPluginDoc(id string, name string) (string, error) {
	if name != string(PluginDocOverview) && name != string(PluginDocChangelog) {
		return "", nil
	}
	info := p.resolvePlugin(id)
	if info.Builtin {
		data, ok := readBuiltinAsset(info.Manifest.ID, name)
		if !ok || len(data) > maxDocBytes {
			return "", nil
		}
		return string(data), nil
	}
	if info.Dir == "" {
		return "", nil
	}
	data, err := os.ReadFile(filepath.Join(info.Dir, name)) // #nosec G304 -- name is one of two constants above, dir is the scan's own folder
	if err != nil || len(data) > maxDocBytes {
		return "", nil
	}
	return string(data), nil
}

// exampleDoc reads a bundled example's document straight out of the
// embedded tree, so Browse can show an overview before anything is
// installed.
func (p *PluginService) exampleDoc(id, name string) string {
	if p.examples == nil || !pluginIDPattern.MatchString(id) {
		return ""
	}
	data, err := fs.ReadFile(p.examples, path.Join(exampleMarketplaceRoot, id, name))
	if err != nil || len(data) > maxDocBytes {
		return ""
	}
	return string(data)
}

// ReadMarketplaceDoc answers the overview a Browse row shows before
// installing. Only the bundled examples can answer it without a
// download; every other entry falls back to its index description.
func (p *PluginService) ReadMarketplaceDoc(marketplace, id string) (string, error) {
	if marketplace == ReservedMarketplaceName {
		return p.exampleDoc(id, string(PluginDocOverview)), nil
	}
	return "", nil
}
