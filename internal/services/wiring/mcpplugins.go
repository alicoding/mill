package wiring

import (
	"github.com/alicoding/mill/internal/adapters/windowing"
	"github.com/alicoding/mill/internal/services/mcpsvc"
	"github.com/alicoding/mill/internal/services/pluginsvc"
	"github.com/alicoding/mill/internal/services/settingssvc"
)

// The adapter joining the plugin platform to the MCP plane
// (docs/goals/0324). mcpsvc declares the interface it needs and never
// imports pluginsvc; this is the only place the two meet, so the
// agent-facing surface and the plugin platform stay separable.

// contributionsChangedEvent is what the webview emits after a
// per-plugin reload re-reads a manifest (plugins/pluginReload.ts): the
// enable/disable path is a Go call and re-syncs itself, but a reload
// happens entirely in the page, so the page is what says so.
const contributionsChangedEvent = "plugin-contributions-changed"

type mcpPluginCatalog struct {
	plugins *pluginsvc.PluginService
}

func (c mcpPluginCatalog) Plugins() []mcpsvc.PluginSummary {
	summaries := c.plugins.PluginSummaries()
	out := make([]mcpsvc.PluginSummary, 0, len(summaries))
	for _, s := range summaries {
		out = append(out, mcpsvc.PluginSummary{
			ID: s.ID, Name: s.Name, Version: s.Version, Enabled: s.Enabled,
			CanvasObjects: s.CanvasObjects, Commands: s.Commands, Steps: s.Steps, Tools: s.Tools,
			Views: s.Views, Captures: s.Captures,
		})
	}
	return out
}

func (c mcpPluginCatalog) Tools() []mcpsvc.PluginToolSpec {
	declared := c.plugins.DeclaredTools()
	out := make([]mcpsvc.PluginToolSpec, 0, len(declared))
	for _, d := range declared {
		out = append(out, mcpsvc.PluginToolSpec{
			PluginID: d.PluginID, PluginName: d.PluginName,
			Name: d.Tool.Name, Description: d.Tool.Description, InputSchema: d.Tool.InputSchema,
			Effect: d.Tool.Effect, RunKind: d.Tool.Run.Kind,
			CommandID: d.Tool.Run.CommandID, StepID: d.Tool.Run.StepID,
		})
	}
	return out
}

func (c mcpPluginCatalog) StepTypeOwners() map[string]string {
	out := map[string]string{}
	for _, st := range c.plugins.StepNodeTypesByPlugin() {
		out[st.NodeType.ID] = st.PluginID
	}
	return out
}

func (c mcpPluginCatalog) CanvasKinds() map[string]string {
	out := map[string]string{}
	for _, k := range c.plugins.ContributedKinds() {
		out[k.Kind] = k.PluginID
	}
	return out
}

func (c mcpPluginCatalog) RunStep(pluginID, stepID, payload string, config map[string]string) (string, error) {
	return c.plugins.RunToolStep(pluginID, stepID, payload, config)
}

func (c mcpPluginCatalog) RunCommand(pluginID, commandID string) (string, error) {
	return c.plugins.RunToolCommand(pluginID, commandID)
}

// WireMCPPluginCatalog makes every runnable plugin's declared
// contributions reachable over MCP, and keeps the tool list current:
// turning a plugin on or off runs through SettingsService, and a
// per-plugin reload announces itself from the page.
func WireMCPPluginCatalog(mill *mcpsvc.MillMCPService, plugins *pluginsvc.PluginService, settings *settingssvc.SettingsService) {
	mill.SetPluginCatalog(mcpPluginCatalog{plugins: plugins})
	settings.SetPluginPolicyChanged(mill.SyncPluginTools)
	windowing.Subscribe(contributionsChangedEvent, func(any) { mill.SyncPluginTools() })
}
