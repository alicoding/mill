package pluginsvc

import (
	"encoding/json"
	"io/fs"
	"path"
	"sort"
)

// Mill's own marketplace (docs/goals/0349): the example extensions the
// binary already carries, offered through the same Browse tab as any
// other index. It exists so Browse is never empty on a fresh install
// and so "install an extension" can be tried once before any source is
// added -- installing one copies it out of the binary, so it needs no
// network at all.
//
// The name "mill" is reserved for exactly this index (marketplace.go);
// an added source claiming it is refused.

// exampleMarketplaceRoot is the folder the embedded example tree is
// rooted at, matching main.go's own embed directive.
const exampleMarketplaceRoot = "examples/plugins"

// SetExampleMarketplace injects the embedded example plugins. Wired by
// the composition root, because go:embed paths are package-relative
// and the examples live at the repository root -- the same injection
// shape docssvc takes for the userdocs tree.
//
//wails:ignore
func (p *PluginService) SetExampleMarketplace(fsys fs.FS) {
	p.examples = fsys
}

// exampleIndex builds the bundled index from the embedded tree,
// reading each example's own manifest so the offering can never drift
// from what would actually be installed. Empty when nothing was
// injected.
func (p *PluginService) exampleIndex() MarketplaceIndex {
	idx := MarketplaceIndex{
		Name:  ReservedMarketplaceName,
		Owner: MarketplaceOwner{Name: "Mill"},
	}
	if p.examples == nil {
		return idx
	}
	entries, err := fs.ReadDir(p.examples, exampleMarketplaceRoot)
	if err != nil {
		return idx
	}
	for _, e := range entries {
		if !e.IsDir() || !pluginIDPattern.MatchString(e.Name()) {
			continue
		}
		m, ok := p.exampleManifest(e.Name())
		if !ok {
			continue
		}
		idx.Plugins = append(idx.Plugins, MarketplaceEntry{
			ID:          m.ID,
			Name:        m.Name,
			Description: m.Description,
			Version:     m.Version,
			Author:      m.Author,
			Kinds:       contributionKinds(m.Contributes),
			Source:      PluginSource{Kind: "path", Path: e.Name()},
		})
	}
	sort.Slice(idx.Plugins, func(i, j int) bool { return idx.Plugins[i].ID < idx.Plugins[j].ID })
	return idx
}

func (p *PluginService) exampleManifest(id string) (Manifest, bool) {
	raw, err := fs.ReadFile(p.examples, path.Join(exampleMarketplaceRoot, id, "manifest.json"))
	if err != nil {
		return Manifest{}, false
	}
	var m Manifest
	if err := json.Unmarshal(raw, &m); err != nil || m.ID != id {
		return Manifest{}, false
	}
	return m, true
}

// hasExample reports whether the bundled tree carries this id.
func (p *PluginService) hasExample(id string) bool {
	if p.examples == nil || !pluginIDPattern.MatchString(id) {
		return false
	}
	info, err := fs.Stat(p.examples, embeddedPluginPath(exampleMarketplaceRoot, id))
	return err == nil && info.IsDir()
}
