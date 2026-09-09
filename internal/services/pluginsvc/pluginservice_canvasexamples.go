package pluginsvc

// CanvasObjectExampleClaim is one valid plugin's declared example for
// one of its contributed canvas-object kinds (goal 0411) --
// atlassvc's own reconcile seeds Board gallery from this list
// (adapted across the service seam by wiring.go); the insert-time
// door reads Example straight off the manifest binding instead, since
// the frontend already holds it at registration.
type CanvasObjectExampleClaim struct {
	PluginID string
	Kind     string
	Builtin  bool
	Example  CanvasObjectExample
}

// CanvasObjectExamples returns the declared example of every VALID
// plugin's canvasObjects contribution, in ListPlugins' own
// deterministic id order -- the same "consulted, never plugin code
// run" shape URLPasteClaims already established: a claim only feeds
// atlassvc's reconcile; the plugin's own JS never runs for this.
//
//wails:ignore
func (p *PluginService) CanvasObjectExamples() []CanvasObjectExampleClaim {
	infos, err := p.ListPlugins()
	if err != nil {
		return nil
	}
	var out []CanvasObjectExampleClaim
	for _, info := range infos {
		if info.Error != "" {
			continue
		}
		for _, obj := range info.Manifest.Contributes.CanvasObjects {
			if obj.Example == nil {
				continue
			}
			out = append(out, CanvasObjectExampleClaim{PluginID: info.Manifest.ID, Kind: obj.Kind, Builtin: info.Builtin, Example: *obj.Example})
		}
	}
	return out
}
