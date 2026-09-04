package pluginsvc

import (
	"fmt"
	"sort"
	"time"

	"github.com/alicoding/mill/internal/adapters/jsengine"
	"github.com/alicoding/mill/internal/adapters/windowing"
	"github.com/alicoding/mill/internal/domain/composition"
)

// The catalog and execution half of the automation contribution
// (docs/goals/0324). What is enumerated here is what the agent plane
// may see; what is executed here is the SAME code path the person's
// own click takes -- a declared step runs through the plugin's own
// step pack, a declared command runs the registered command in the
// webview. No second implementation of either.

// DeclaredTool is one runnable plugin's declared tool, carrying the
// plugin it belongs to so the host can name it unambiguously.
type DeclaredTool struct {
	PluginID   string
	PluginName string
	Tool       ToolContribution
}

// PluginStepNodeType pairs a runnable plugin's synthesized step type
// with the plugin that contributed it -- the step catalog alone can't
// say, since a node type id is not a parseable identity.
type PluginStepNodeType struct {
	PluginID string
	NodeType composition.NodeType
}

// ContributedKind is one plugin's declared canvas-object kind.
type ContributedKind struct {
	PluginID string
	Kind     string
}

// PluginSummary is one scanned plugin as an agent sees it: identity,
// whether it may actually run, and what it contributes -- never its
// folder, its files or its trust internals.
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

// runnable reports whether this plugin loaded cleanly AND the one run
// policy the Go side applies (settingsTrust.mayRun) lets it run. The
// user's on/off switch is the grant: a plugin turned off contributes
// no tools, exactly as it contributes no steps and no captures.
func (p *PluginService) runnable(info PluginInfo) bool {
	if info.Error != "" {
		return false
	}
	return p.mayRun == nil || p.mayRun(info.Manifest.ID, info.Builtin)
}

// PluginSummaries is every scanned plugin with its declared
// contributions -- including ones that may not run, which report
// Enabled false rather than vanishing, so an agent can tell "no such
// plugin" from "that plugin is turned off".
//
//wails:ignore
func (p *PluginService) PluginSummaries() []PluginSummary {
	infos, err := p.ListPlugins()
	if err != nil {
		return nil
	}
	out := make([]PluginSummary, 0, len(infos))
	for _, info := range infos {
		m := info.Manifest
		s := PluginSummary{
			ID: m.ID, Name: m.Name, Version: m.Version, Enabled: p.runnable(info),
			CanvasObjects: []string{}, Commands: []string{}, Steps: []string{}, Tools: []string{},
			Views: len(m.Contributes.Views), Captures: len(m.Contributes.Captures),
		}
		for _, o := range m.Contributes.CanvasObjects {
			s.CanvasObjects = append(s.CanvasObjects, o.Kind)
		}
		for _, c := range m.Contributes.Commands {
			s.Commands = append(s.Commands, c.ID)
		}
		for _, st := range m.Contributes.Steps {
			s.Steps = append(s.Steps, st.ID)
		}
		for _, t := range m.Contributes.Tools {
			s.Tools = append(s.Tools, t.Name)
		}
		out = append(out, s)
	}
	return out
}

// DeclaredTools is every RUNNABLE plugin's declared tools, sorted so
// the MCP tool list is stable across scans.
//
//wails:ignore
func (p *PluginService) DeclaredTools() []DeclaredTool {
	infos, err := p.ListPlugins()
	if err != nil {
		return nil
	}
	var out []DeclaredTool
	for _, info := range infos {
		if !p.runnable(info) {
			continue
		}
		name := info.Manifest.Name
		if name == "" {
			name = info.Manifest.ID
		}
		for _, t := range info.Manifest.Contributes.Tools {
			out = append(out, DeclaredTool{PluginID: info.Manifest.ID, PluginName: name, Tool: t})
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].PluginID != out[j].PluginID {
			return out[i].PluginID < out[j].PluginID
		}
		return out[i].Tool.Name < out[j].Tool.Name
	})
	return out
}

// ContributedKinds is every runnable plugin's canvas-object kinds --
// what a host may accept as a board object's kind beyond Mill's own.
//
//wails:ignore
func (p *PluginService) ContributedKinds() []ContributedKind {
	infos, err := p.ListPlugins()
	if err != nil {
		return nil
	}
	var out []ContributedKind
	for _, info := range infos {
		if !p.runnable(info) {
			continue
		}
		for _, o := range info.Manifest.Contributes.CanvasObjects {
			out = append(out, ContributedKind{PluginID: info.Manifest.ID, Kind: o.Kind})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Kind < out[j].Kind })
	return out
}

// StepNodeTypesByPlugin is StepNodeTypes' catalog with each type's
// contributing plugin kept alongside it.
//
//wails:ignore
func (p *PluginService) StepNodeTypesByPlugin() []PluginStepNodeType {
	infos, err := p.ListPlugins()
	if err != nil {
		return nil
	}
	var out []PluginStepNodeType
	for _, info := range infos {
		for _, ext := range p.pluginStepTypes(info) {
			out = append(out, PluginStepNodeType{PluginID: info.Manifest.ID, NodeType: ext.NodeType})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].NodeType.ID < out[j].NodeType.ID })
	return out
}

// RunToolStep runs one declared step of a runnable plugin over the
// payload and config a tool call supplied, through the SAME step pack
// a workflow run uses. Returns the step's output payload.
//
//wails:ignore
func (p *PluginService) RunToolStep(pluginID, stepID, payload string, config map[string]string) (string, error) {
	info := p.resolvePlugin(pluginID)
	if !p.runnable(info) {
		return "", fmt.Errorf("plugin %q is not available", pluginID)
	}
	pack, err := p.stepPack(info)
	if err != nil {
		return "", err
	}
	out, err := pack.Perform(stepID, jsengine.Input{Payload: payload, Config: config})
	if err != nil {
		return "", err
	}
	return out.Payload, nil
}

// commandInvokeEvent / commandResultEvent are the request/reply pair
// the webview answers on -- the same Go-asks-the-page handshake shape
// the leave/flush gate already uses (settingssvc's mill-before-quit /
// mill-flushed), with a request id because several tool calls may be
// in flight at once. Payloads are plain string maps, so no registered
// event type can silently drop one.
const (
	commandInvokeEvent = "plugin-tool-invoke"
	commandResultEvent = "plugin-tool-result"
	// commandReplyBound is how long a tool call waits for the page. A
	// command runs synchronously in the webview, so anything longer
	// means no page is listening at all.
	commandReplyBound = 10 * time.Second
)

// RunToolCommand asks the webview to run one of a plugin's own
// registered commands and waits, bounded, for its answer. A command's
// run() takes no arguments, which is exactly why a command-kind tool
// may declare none.
//
//wails:ignore
func (p *PluginService) RunToolCommand(pluginID, commandID string) (string, error) {
	info := p.resolvePlugin(pluginID)
	if !p.runnable(info) {
		return "", fmt.Errorf("plugin %q is not available", pluginID)
	}
	declared := false
	for _, c := range info.Manifest.Contributes.Commands {
		declared = declared || c.ID == commandID
	}
	if !declared {
		return "", fmt.Errorf("plugin %q does not declare the command %q", pluginID, commandID)
	}
	if p.runCommand == nil {
		return "", fmt.Errorf("the app did not answer -- no window is open to run %q in", commandID)
	}
	return p.runCommand(pluginID, commandID)
}

// invokeCommandInWebview is the production bridge: subscribe first,
// then emit, so a page that answers immediately is never missed.
func invokeCommandInWebview(pluginID, commandID string) (string, error) {
	requestID := fmt.Sprintf("%s.%s.%d", pluginID, commandID, time.Now().UnixNano())
	data, ok := windowing.RequestReply(
		commandInvokeEvent,
		map[string]string{"requestId": requestID, "pluginId": pluginID, "commandId": commandID},
		commandResultEvent,
		commandReplyBound,
		func(d any) bool { return replyField(d, "requestId") == requestID },
	)
	if !ok {
		return "", fmt.Errorf("the app did not answer -- %q did not finish within %s", commandID, commandReplyBound)
	}
	if replyField(data, "ok") != "true" {
		if msg := replyField(data, "error"); msg != "" {
			return "", fmt.Errorf("%s", msg)
		}
		return "", fmt.Errorf("%q did not run", commandID)
	}
	return replyField(data, "result"), nil
}

// replyField reads one string field out of an event payload that
// crossed the wire as decoded JSON.
func replyField(data any, key string) string {
	m, ok := data.(map[string]any)
	if !ok {
		return ""
	}
	s, _ := m[key].(string)
	return s
}
