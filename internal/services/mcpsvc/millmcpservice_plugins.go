package mcpsvc

import (
	"context"
	"encoding/json"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// The plugin plane as the agent plane sees it (docs/goals/0324).
// Until this file a plugin was invisible over MCP: an agent could not
// tell what was installed, its steps came through the step catalog
// with no way to know they were a plugin's, its canvas kinds were
// refused outright, and nothing it contributed was callable. What
// changes is only VISIBILITY and REACH -- consent is untouched: a
// write-effect plugin tool passes the same write gate and the same
// per-write approval as every other write here, and a plugin the user
// turned off contributes nothing at all.
//
// This service depends on an INTERFACE, never on pluginsvc: the
// composition root wires the real catalog (internal/services/wiring),
// so the MCP plane and the plugin platform stay separable.

// PluginSummary is one installed plugin as list_plugins reports it.
type PluginSummary struct {
	ID            string
	Name          string
	Version       string
	Enabled       bool
	CanvasObjects []string
	Commands      []string
	Steps         []string
	Tools         []string
	Views         int
	Captures      int
}

// PluginToolSpec is one declared, currently-reachable plugin tool.
// InputSchema is the plugin author's own JSON Schema, passed through
// to the MCP tool list verbatim.
type PluginToolSpec struct {
	PluginID    string
	PluginName  string
	Name        string
	Description string
	InputSchema json.RawMessage
	// Effect is "read" (answers directly) or "write" (write gate plus
	// per-write approval).
	Effect string
	// RunKind is "command", "step" or "query"; CommandID/StepID name
	// what it runs for the first two.
	RunKind   string
	CommandID string
	StepID    string
}

// PluginCatalog is the plugin plane this service reads and calls
// through. Every method answers from a fresh scan, so a plugin turned
// off, reloaded or edited is reflected without a restart.
type PluginCatalog interface {
	// Plugins is every installed plugin, enabled or not.
	Plugins() []PluginSummary
	// Tools is every RUNNABLE plugin's declared tools.
	Tools() []PluginToolSpec
	// StepTypeOwners maps a synthesized step type's catalog id to the
	// plugin that contributed it.
	StepTypeOwners() map[string]string
	// CanvasKinds maps a runnable plugin's contributed canvas-object
	// kind to that plugin's id.
	CanvasKinds() map[string]string
	// RunStep performs one declared step over a tool call's payload and
	// config, returning the step's output.
	RunStep(pluginID, stepID, payload string, config map[string]string) (string, error)
	// RunCommand runs one declared, argument-less command in the
	// webview and returns whatever it reported.
	RunCommand(pluginID, commandID string) (string, error)
}

// SetPluginCatalog late-binds the plugin plane and brings the current
// plugin tools onto the server -- same injected-seam shape as
// SetAtlasService, since the plugin service is constructed before this
// one at the composition root.
func (m *MillMCPService) SetPluginCatalog(c PluginCatalog) {
	m.plugins = c
	m.SyncPluginTools()
}

// pluginSummaryOut is list_plugins' wire shape: lowercase, agent-facing
// field names, deliberately distinct from the Go struct's own.
type pluginSummaryOut struct {
	ID            string               `json:"id"`
	Name          string               `json:"name"`
	Version       string               `json:"version"`
	Enabled       bool                 `json:"enabled"`
	Contributions pluginContributesOut `json:"contributions"`
}

type pluginContributesOut struct {
	CanvasObjects []string `json:"canvasObjects"`
	Commands      []string `json:"commands"`
	Steps         []string `json:"steps"`
	Tools         []string `json:"tools"`
	Views         int      `json:"views"`
	Captures      int      `json:"captures"`
}

func (m *MillMCPService) listPluginsResult() []pluginSummaryOut {
	out := []pluginSummaryOut{}
	if m.plugins == nil {
		return out
	}
	for _, p := range m.plugins.Plugins() {
		out = append(out, pluginSummaryOut{
			ID: p.ID, Name: p.Name, Version: p.Version, Enabled: p.Enabled,
			Contributions: pluginContributesOut{
				CanvasObjects: orEmpty(p.CanvasObjects), Commands: orEmpty(p.Commands),
				Steps: orEmpty(p.Steps), Tools: orEmpty(p.Tools),
				Views: p.Views, Captures: p.Captures,
			},
		})
	}
	return out
}

// orEmpty keeps every list in the result a JSON array rather than
// null, so a client can iterate without a nil check.
func orEmpty(in []string) []string {
	if in == nil {
		return []string{}
	}
	return in
}

// pluginToolName is the one place a plugin tool's MCP name is spelled:
// the plugin prefix keeps two plugins' identically-named tools apart
// and tells an agent at a glance that this tool came from an
// extension, not from Mill itself.
func pluginToolName(pluginID, name string) string {
	return "plugin_" + pluginID + "_" + name
}

// pluginSourceLabel marks a catalog entry a plugin contributed, in the
// same shape wherever it appears.
func pluginSourceLabel(pluginID string) string {
	return "plugin:" + pluginID
}

func (m *MillMCPService) registerPluginTools() {
	mcp.AddTool(m.server, &mcp.Tool{
		Name: "list_plugins",
		Description: "Every plugin installed in this Mill, whether it is turned on, and what it contributes: " +
			"canvas object kinds, palette command ids, workflow step ids, agent-callable tool names, and how " +
			"many views and captures it adds. A turned-off plugin is listed with enabled false and contributes " +
			"nothing callable. Its tools appear in the tool list as plugin_<pluginId>_<toolName>. Read-only.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, any, error) {
		res, err := jsonResult(m.listPluginsResult())
		return res, nil, err
	})
}

// stepTypeOut is one catalog entry as list_step_types reports it: the
// node type exactly as before, plus who contributed it. Embedded, so
// every existing field keeps its existing name and a caller that never
// heard of plugins reads the same shape it always did.
type stepTypeOut struct {
	composition.NodeType
	Source string `json:"source,omitempty"`
}

// attributeStepTypes marks each catalog entry a plugin contributed.
// composition.NodeTypes() already carries plugin steps (the platform's
// own external-node-type lookup); what it cannot say is WHICH plugin,
// since a node type id is not a parseable identity.
func (m *MillMCPService) attributeStepTypes(types []composition.NodeType) []stepTypeOut {
	owners := map[string]string{}
	if m.plugins != nil {
		owners = m.plugins.StepTypeOwners()
	}
	out := make([]stepTypeOut, 0, len(types))
	for _, nt := range types {
		entry := stepTypeOut{NodeType: nt}
		if pluginID, ok := owners[nt.ID]; ok {
			entry.Source = pluginSourceLabel(pluginID)
		}
		out = append(out, entry)
	}
	return out
}
