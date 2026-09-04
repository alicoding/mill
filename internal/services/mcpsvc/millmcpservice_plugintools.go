package mcpsvc

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Registering a runnable plugin's declared tools on the live server,
// and running one when it is called (docs/goals/0324). The tool list
// is SYNCHRONIZED, not built once: turning a plugin off in Settings,
// turning it back on, or reloading it re-runs this and the MCP client
// sees the tool appear or disappear without a restart, through the
// SDK's own tools/list_changed notification.

// pluginPayloadArgument is the argument a step-kind tool carries its
// step's input in; every other argument is one of that step's config
// values. Manifest validation (pluginsvc) already pins this shape, so
// nothing here has to re-derive it.
const pluginPayloadArgument = "text"

// SyncPluginTools brings the server's plugin tools in line with what
// the catalog currently offers: gone-away tools are removed, current
// ones (re)added. Safe to call repeatedly and from any goroutine.
func (m *MillMCPService) SyncPluginTools() {
	if m.plugins == nil || m.server == nil {
		return
	}
	specs := m.plugins.Tools()
	m.pluginMu.Lock()
	stale := make([]string, 0, len(m.pluginToolNames))
	wanted := make(map[string]bool, len(specs))
	for _, s := range specs {
		wanted[pluginToolName(s.PluginID, s.Name)] = true
	}
	for name := range m.pluginToolNames {
		if !wanted[name] {
			stale = append(stale, name)
			delete(m.pluginToolNames, name)
			delete(m.pluginExecutors, name)
		}
	}
	for _, s := range specs {
		name := pluginToolName(s.PluginID, s.Name)
		m.pluginToolNames[name] = true
		if s.Effect == "write" {
			spec := s
			m.pluginExecutors[name] = func(argsJSON string) (string, error) { return m.runPluginTool(spec, argsJSON) }
		}
	}
	m.pluginMu.Unlock()

	sort.Strings(stale)
	if len(stale) > 0 {
		m.server.RemoveTools(stale...)
	}
	for _, s := range specs {
		m.addPluginTool(s)
	}
}

// pluginExecutor answers the plugin half of execute's dispatch. Kept
// behind its own lock because plugin tools, unlike every compiled-in
// write tool, come and go while the server is running.
func (m *MillMCPService) pluginExecutor(toolName string) (mcpWriteExecutor, bool) {
	m.pluginMu.RLock()
	defer m.pluginMu.RUnlock()
	fn, ok := m.pluginExecutors[toolName]
	return fn, ok
}

// addPluginTool registers one declared tool. The schema is the plugin
// author's own, passed through untouched -- the agent reads the
// contract the author wrote, not a restatement of it.
func (m *MillMCPService) addPluginTool(s PluginToolSpec) {
	name := pluginToolName(s.PluginID, s.Name)
	description := fmt.Sprintf("%s (from the %s plugin)", strings.TrimSpace(s.Description), s.PluginName)
	if s.Effect == "write" {
		description += " " + approvalPollNote
	}
	m.server.AddTool(&mcp.Tool{
		Name:        name,
		Description: description,
		InputSchema: json.RawMessage(s.InputSchema),
	}, func(_ context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		argsJSON := pluginArgsJSON(req)
		if s.Effect != "write" {
			text, err := m.runPluginTool(s, argsJSON)
			if err != nil {
				return toolErrorResult(err), nil
			}
			return textResult(text), nil
		}
		if err := m.requireWriteEnabled(); err != nil {
			return toolErrorResult(err), nil
		}
		res, err := m.gateWrite(name, pluginWriteDescription(s, argsJSON), argsJSON)
		if err != nil {
			return toolErrorResult(err), nil
		}
		return res, nil
	})
}

// toolErrorResult reports a failure the way every compiled-in tool
// here already does. The SDK's typed AddTool sets IsError for its
// handlers automatically; a raw handler (which a plugin tool must be,
// since its schema is data, not a Go type) has to do it itself, or the
// same failure would reach an agent as a transport error from a plugin
// tool and as a tool result from Mill's own.
func toolErrorResult(err error) *mcp.CallToolResult {
	res := &mcp.CallToolResult{}
	res.SetError(err)
	return res
}

// pluginArgsJSON normalizes a call's arguments to a JSON object, so a
// tool that declares no properties still gets a decodable payload.
func pluginArgsJSON(req *mcp.CallToolRequest) string {
	if req == nil || req.Params == nil || len(req.Params.Arguments) == 0 {
		return "{}"
	}
	return string(req.Params.Arguments)
}

// pluginWriteDescription is what the person approving actually reads:
// the plugin author's own sentence, then what this particular call
// would do it with.
func pluginWriteDescription(s PluginToolSpec, argsJSON string) string {
	summary := pluginArgsSummary(argsJSON)
	if summary == "" {
		return strings.TrimSpace(s.Description)
	}
	return strings.TrimSpace(s.Description) + " -- " + summary
}

// maxArgsSummaryLen keeps an approval banner one line: the person is
// deciding on the ACTION, and a wall of arguments hides it.
const maxArgsSummaryLen = 120

func pluginArgsSummary(argsJSON string) string {
	var args map[string]any
	if err := json.Unmarshal([]byte(argsJSON), &args); err != nil || len(args) == 0 {
		return ""
	}
	keys := make([]string, 0, len(args))
	for k := range args {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		parts = append(parts, fmt.Sprintf("%s: %s", k, pluginArgValue(args[k])))
	}
	summary := strings.Join(parts, ", ")
	if len(summary) > maxArgsSummaryLen {
		summary = summary[:maxArgsSummaryLen] + "…"
	}
	return summary
}

func pluginArgValue(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	data, err := json.Marshal(v)
	if err != nil {
		return ""
	}
	return string(data)
}

// runPluginTool dispatches one call by what the manifest said it runs.
// Each branch reaches the SAME code path the person's own use takes --
// the step pack a workflow run uses, the registered command a palette
// entry runs, the content index the board renders from.
func (m *MillMCPService) runPluginTool(s PluginToolSpec, argsJSON string) (string, error) {
	if m.plugins == nil {
		return "", fmt.Errorf("the plugin platform is not available")
	}
	var args map[string]any
	if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
		return "", err
	}
	switch s.RunKind {
	case "command":
		return m.plugins.RunCommand(s.PluginID, s.CommandID)
	case "step":
		payload, _ := args[pluginPayloadArgument].(string)
		config := map[string]string{}
		for k, v := range args {
			if k != pluginPayloadArgument {
				config[k] = pluginArgValue(v)
			}
		}
		return m.plugins.RunStep(s.PluginID, s.StepID, payload, config)
	case "query":
		if err := m.requireAtlas(); err != nil {
			return "", err
		}
		kind, _ := args["kind"].(string)
		parentID, _ := args["parentId"].(string)
		return jsonText(m.atlas.ListContents(kind, parentID))
	}
	return "", fmt.Errorf("plugin tool %q declares no runnable action", s.Name)
}
