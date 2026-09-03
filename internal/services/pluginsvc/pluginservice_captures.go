package pluginsvc

import (
	"fmt"
	"sort"
	"strings"
)

// Captures (goal 0309): a plugin declares quick-capture surfaces in
// its manifest -- declare-first, so the Quick Panel (which runs no
// plugin code) can offer "New <label>" rows straight off the manifest
// -- and registers each face at activate() in the capture window,
// where plugins do load.

// CaptureContribution is one declared capture.
type CaptureContribution struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Description string `json:"description"`
}

func validateCaptures(captures []CaptureContribution) string {
	seen := map[string]bool{}
	for _, c := range captures {
		if !pluginIDPattern.MatchString(c.ID) {
			return fmt.Sprintf("contributed capture id %q must be lowercase letters, digits, and hyphens", c.ID)
		}
		if strings.TrimSpace(c.Label) == "" {
			return fmt.Sprintf("contributed capture %q needs a label", c.ID)
		}
		if seen[c.ID] {
			return fmt.Sprintf("contributed capture %q is declared twice", c.ID)
		}
		seen[c.ID] = true
	}
	return ""
}

// PluginCapture is one runnable plugin's declared capture as the Quick
// Panel and the palette list it.
type PluginCapture struct {
	PluginID    string `json:"pluginId"`
	PluginName  string `json:"pluginName"`
	ID          string `json:"id"`
	Label       string `json:"label"`
	Description string `json:"description"`
}

// Captures lists every runnable plugin's declared captures, by plugin
// then capture id.
func (p *PluginService) Captures() []PluginCapture {
	infos, err := p.ListPlugins()
	if err != nil {
		return nil
	}
	out := []PluginCapture{}
	for _, info := range infos {
		if info.Error != "" || (p.mayRun != nil && !p.mayRun(info.Manifest.ID, info.Builtin)) {
			continue
		}
		name := info.Manifest.Name
		if name == "" {
			name = info.Manifest.ID
		}
		for _, c := range info.Manifest.Contributes.Captures {
			out = append(out, PluginCapture{PluginID: info.Manifest.ID, PluginName: name, ID: c.ID, Label: c.Label, Description: c.Description})
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].PluginID != out[j].PluginID {
			return out[i].PluginID < out[j].PluginID
		}
		return out[i].ID < out[j].ID
	})
	return out
}
