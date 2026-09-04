package mcpsvc

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/guardrail"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// The plugin plane over MCP (goal 0324), driven through a real MCP
// client against a real server -- the same loopback-HTTP harness every
// other tool tier in this package uses. The catalog is a fake because
// pluginsvc is deliberately NOT a dependency of this package: what is
// proved here is the contract mcpsvc states, not the plugin platform.

type fakeCatalog struct {
	plugins    []PluginSummary
	tools      []PluginToolSpec
	stepOwners map[string]string
	kinds      map[string]string
	stepCalls  []string
	cmdCalls   []string
	stepErr    error
}

func (f *fakeCatalog) Plugins() []PluginSummary          { return f.plugins }
func (f *fakeCatalog) Tools() []PluginToolSpec           { return f.tools }
func (f *fakeCatalog) StepTypeOwners() map[string]string { return f.stepOwners }
func (f *fakeCatalog) CanvasKinds() map[string]string    { return f.kinds }

func (f *fakeCatalog) RunStep(pluginID, stepID, payload string, config map[string]string) (string, error) {
	f.stepCalls = append(f.stepCalls, fmt.Sprintf("%s/%s/%s/%s", pluginID, stepID, payload, config["mode"]))
	if f.stepErr != nil {
		return "", f.stepErr
	}
	return strings.ToUpper(payload), nil
}

func (f *fakeCatalog) RunCommand(pluginID, commandID string) (string, error) {
	f.cmdCalls = append(f.cmdCalls, pluginID+"/"+commandID)
	return "ran " + commandID, nil
}

func textCaseTool() PluginToolSpec {
	return PluginToolSpec{
		PluginID: "mill-textcase", PluginName: "Text case", Name: "change_text_case",
		Description: "Changes the case of text.",
		InputSchema: json.RawMessage(`{"type":"object","properties":{"text":{"type":"string"},"mode":{"type":"string"}}}`),
		Effect:      "read", RunKind: "step", StepID: "text-case",
	}
}

func noteTool() PluginToolSpec {
	return PluginToolSpec{
		PluginID: "mill-clipper", PluginName: "Web clipper", Name: "clip_page",
		Description: "Clips a page onto the board.",
		InputSchema: json.RawMessage(`{"type":"object","properties":{"text":{"type":"string"}}}`),
		Effect:      "write", RunKind: "step", StepID: "clip",
	}
}

func newPluginHarness(t *testing.T, addr string, catalog *fakeCatalog) *atlasMCPHarness {
	t.Helper()
	h := newAtlasMCPHarness(t, addr)
	h.svc.SetPluginCatalog(catalog)
	return h
}

func TestListPlugins_ReportsContributionsAndEnablement(t *testing.T) {
	catalog := &fakeCatalog{plugins: []PluginSummary{
		{ID: "mill-textcase", Name: "Text case", Version: "1.0.0", Enabled: true, Steps: []string{"text-case"}, Tools: []string{"change_text_case"}},
		{ID: "mill-bookmark", Name: "Bookmark", Version: "1.0.0", Enabled: false, CanvasObjects: []string{"bookmark"}},
	}}
	h := newPluginHarness(t, "127.0.0.1:18160", catalog)

	var out []pluginSummaryOut
	if err := json.Unmarshal([]byte(h.call(t, "list_plugins", nil)), &out); err != nil {
		t.Fatalf("list_plugins result is not the typed JSON: %v", err)
	}
	if len(out) != 2 {
		t.Fatalf("list_plugins returned %d plugins, want 2: %+v", len(out), out)
	}
	if !out[0].Enabled || out[0].ID != "mill-textcase" || len(out[0].Contributions.Tools) != 1 {
		t.Errorf("textcase row is wrong: %+v", out[0])
	}
	if out[1].Enabled {
		t.Errorf("a turned-off plugin must report enabled false: %+v", out[1])
	}
	if out[1].Contributions.Commands == nil || out[1].Contributions.Steps == nil {
		t.Errorf("every contribution list must be an array, never null: %+v", out[1].Contributions)
	}
}

func TestListStepTypes_MarksAPluginsOwnStep(t *testing.T) {
	const id = "process-mill-textcase-text-case"
	composition.SetExternalNodeTypeLookup(func() []composition.ExternalNodeType {
		return []composition.ExternalNodeType{{NodeType: composition.NodeType{
			ID: id, Kind: composition.KindProcess, Label: "Text case", Description: "Changes the text's case.",
			Output: "Text", Consumes: []composition.PayloadKind{composition.PayloadText},
			Produces: composition.PayloadProduce{Kind: composition.PayloadText}, Effect: guardrail.ClassNone,
		}}}
	})
	t.Cleanup(func() { composition.SetExternalNodeTypeLookup(nil) })

	h := newPluginHarness(t, "127.0.0.1:18161", &fakeCatalog{stepOwners: map[string]string{id: "mill-textcase"}})

	var types []struct {
		ID     string `json:"ID"`
		Source string `json:"source"`
	}
	if err := json.Unmarshal([]byte(h.call(t, "list_step_types", nil)), &types); err != nil {
		t.Fatalf("list_step_types result is not the typed JSON: %v", err)
	}
	var sawPluginStep, sawBuiltIn bool
	for _, nt := range types {
		if nt.ID == id {
			sawPluginStep = true
			if nt.Source != "plugin:mill-textcase" {
				t.Errorf("plugin step source = %q, want plugin:mill-textcase", nt.Source)
			}
		}
		if nt.ID == "trigger-manual" {
			sawBuiltIn = true
			if nt.Source != "" {
				t.Errorf("Mill's own step carries source %q, want none", nt.Source)
			}
		}
	}
	if !sawPluginStep || !sawBuiltIn {
		t.Fatalf("list_step_types must carry both catalogs (plugin step %v, built-in %v)", sawPluginStep, sawBuiltIn)
	}
}

func TestAtlasListKinds_IncludesPluginCanvasKinds(t *testing.T) {
	h := newPluginHarness(t, "127.0.0.1:18162", &fakeCatalog{kinds: map[string]string{"bookmark": "mill-bookmark"}})

	var out atlasListKindsResult
	if err := json.Unmarshal([]byte(h.call(t, "atlas_list_kinds", nil)), &out); err != nil {
		t.Fatalf("atlas_list_kinds result is not the typed JSON: %v", err)
	}
	found := map[string]string{}
	for _, k := range out.BoardObjectKinds {
		found[k.Kind] = k.Source
	}
	if _, ok := found["diagram"]; !ok {
		t.Errorf("boardObjectKinds is missing Mill's own kinds: %+v", out.BoardObjectKinds)
	}
	if found["diagram"] != "" {
		t.Errorf("Mill's own kind carries source %q, want none", found["diagram"])
	}
	if found["bookmark"] != "plugin:mill-bookmark" {
		t.Errorf("bookmark source = %q, want plugin:mill-bookmark", found["bookmark"])
	}
}

func TestAtlasCreateBoardObject_AcceptsAPluginsKind(t *testing.T) {
	h := newPluginHarness(t, "127.0.0.1:18163", &fakeCatalog{kinds: map[string]string{"bookmark": "mill-bookmark"}})
	if err := h.svc.store.Set(MCPWriteEnabledKey, "true"); err != nil {
		t.Fatalf("enable writes: %v", err)
	}
	if err := h.svc.store.Set(MCPWriteApprovalKey, "false"); err != nil {
		t.Fatalf("disable approval: %v", err)
	}

	text := h.call(t, "atlas_create_board_object", map[string]any{"kind": "bookmark", "payload": map[string]string{"title": "Mill"}})
	if !strings.Contains(text, `"kind": "bookmark"`) {
		t.Fatalf("atlas_create_board_object did not create the plugin's kind:\n%s", text)
	}

	res, err := h.session.CallTool(h.ctx, &mcp.CallToolParams{Name: "atlas_create_board_object", Arguments: map[string]any{"kind": "sparkle"}})
	if err != nil {
		t.Fatalf("transport error: %v", err)
	}
	if !res.IsError {
		t.Fatalf("a kind no plugin contributes must be refused, got %+v", res.Content)
	}
}

func TestPluginTool_ReadRunsTheStepAndAnswers(t *testing.T) {
	catalog := &fakeCatalog{tools: []PluginToolSpec{textCaseTool()}}
	h := newPluginHarness(t, "127.0.0.1:18164", catalog)

	text := h.call(t, "plugin_mill-textcase_change_text_case", map[string]any{"text": "hello", "mode": "upper"})
	if text != "HELLO" {
		t.Errorf("tool returned %q, want HELLO", text)
	}
	if len(catalog.stepCalls) != 1 || catalog.stepCalls[0] != "mill-textcase/text-case/hello/upper" {
		t.Errorf("the call did not reach the step with its payload and config: %+v", catalog.stepCalls)
	}
}

func TestPluginTool_CommandKindRunsThroughTheHostBridge(t *testing.T) {
	catalog := &fakeCatalog{tools: []PluginToolSpec{{
		PluginID: "mill-index", PluginName: "Board index", Name: "refresh_board_index",
		Description: "Lists the board again.", InputSchema: json.RawMessage(`{"type":"object","properties":{}}`),
		Effect: "read", RunKind: "command", CommandID: "refresh",
	}}}
	h := newPluginHarness(t, "127.0.0.1:18165", catalog)

	if text := h.call(t, "plugin_mill-index_refresh_board_index", nil); text != "ran refresh" {
		t.Errorf("tool returned %q, want \"ran refresh\"", text)
	}
	if len(catalog.cmdCalls) != 1 || catalog.cmdCalls[0] != "mill-index/refresh" {
		t.Errorf("the call did not reach the command: %+v", catalog.cmdCalls)
	}
}

func TestPluginTool_WriteRefusedWithWritesOffAndParksWithThemOn(t *testing.T) {
	catalog := &fakeCatalog{tools: []PluginToolSpec{noteTool()}}
	h := newPluginHarness(t, "127.0.0.1:18166", catalog)

	res, err := h.session.CallTool(h.ctx, &mcp.CallToolParams{Name: "plugin_mill-clipper_clip_page", Arguments: map[string]any{"text": "x"}})
	if err != nil {
		t.Fatalf("transport error: %v", err)
	}
	if !res.IsError {
		t.Fatalf("a write-effect plugin tool must refuse while MCP writes are off, got %+v", res.Content)
	}
	if len(catalog.stepCalls) != 0 {
		t.Fatalf("nothing may run before the write gate opens: %+v", catalog.stepCalls)
	}

	if err := h.svc.store.Set(MCPWriteEnabledKey, "true"); err != nil {
		t.Fatalf("enable writes: %v", err)
	}
	text := h.call(t, "plugin_mill-clipper_clip_page", map[string]any{"text": "x"})
	if !strings.Contains(text, "parked") {
		t.Fatalf("a write-effect plugin tool must park for approval, got %q", text)
	}
	if len(catalog.stepCalls) != 0 {
		t.Fatalf("a parked write must not have run yet: %+v", catalog.stepCalls)
	}
	pending := h.svc.PendingMCPWrites()
	if len(pending) != 1 || !strings.Contains(pending[0].Description, "Clips a page onto the board.") {
		t.Fatalf("the parked write's prompt must carry the plugin author's own sentence: %+v", pending)
	}
	if !strings.Contains(pending[0].Description, "text: x") {
		t.Errorf("the parked write's prompt must summarize the call's arguments: %q", pending[0].Description)
	}
}

func TestSyncPluginTools_DropsATurnedOffPluginsTool(t *testing.T) {
	catalog := &fakeCatalog{tools: []PluginToolSpec{textCaseTool()}}
	h := newPluginHarness(t, "127.0.0.1:18167", catalog)

	if !h.hasTool(t, "plugin_mill-textcase_change_text_case") {
		t.Fatalf("the tool must be listed while its plugin is on")
	}
	catalog.tools = nil
	h.svc.SyncPluginTools()
	if h.hasTool(t, "plugin_mill-textcase_change_text_case") {
		t.Fatalf("turning the plugin off must remove its tool from the list")
	}
}

func (h *atlasMCPHarness) hasTool(t *testing.T, name string) bool {
	t.Helper()
	listed, err := h.session.ListTools(h.ctx, nil)
	if err != nil {
		t.Fatalf("ListTools: %v", err)
	}
	for _, tool := range listed.Tools {
		if tool.Name == name {
			return true
		}
	}
	return false
}
