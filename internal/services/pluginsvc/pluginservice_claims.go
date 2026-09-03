package pluginsvc

// IngestionClaim is one valid plugin's claim on bare-URL pastes as
// the paste chain's wiring consumes it (docs/goals/0251).
type IngestionClaim struct {
	PluginID string
	Kind     string
	// Builtin marks a claim from a plugin shipped in the bundle -- exempt
	// from the run gate and the allow-list (ADR-0051 §4).
	Builtin bool
}

// URLPasteClaims returns the claims of every VALID plugin whose
// manifest sets pastesURLs, in ListPlugins' own deterministic id
// order. Consulted by the paste recognizer chain through the
// composition root's enablement filter -- never by running plugin
// code: a claim only routes the paste; the plugin's JS renders the
// object it produced, later, in the webview.
//
//wails:ignore
func (p *PluginService) URLPasteClaims() []IngestionClaim {
	infos, err := p.ListPlugins()
	if err != nil {
		return nil
	}
	var out []IngestionClaim
	for _, info := range infos {
		if info.Error != "" {
			continue
		}
		for _, obj := range info.Manifest.Contributes.CanvasObjects {
			if obj.PastesURLs {
				out = append(out, IngestionClaim{PluginID: info.Manifest.ID, Kind: obj.Kind, Builtin: info.Builtin})
			}
		}
	}
	return out
}
