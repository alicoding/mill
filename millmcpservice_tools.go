package main

import (
	"context"
	"fmt"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// MCP Tools over the same export/import model the UI's own buttons use
// (compositionservice_export.go, configureservice_export.go) --
// docs/adr/0017's Update: the read side (export_*) is the Resources'
// data reshaped as callable tools (many hosts reach for tools far more
// readily than resources); the write side (import_*) is gated by a
// single, coarse, default-off Settings toggle (ADR-0017 Option B's
// authoring-capability gate). Per-write synchronous human approval --
// Option B's second half -- remains real, open future work; the toggle
// is deliberate per-instance opt-in, not a resolution of that.
//
// Secrets are structurally absent from everything these tools can
// touch: exports never carry one (the wire shapes have no secret
// field), and imports create entities whose secret is simply not set
// yet -- same guarantees the UI's own Export/Import already has.

// mcpWriteEnabledKey stores the gate as the string "true"/"false" --
// matching every other settings key's string convention
// (settingsservice.go).
const mcpWriteEnabledKey = "mcp-write-tools-enabled"

func (m *MillMCPService) writeEnabled() bool {
	v, ok := m.store.Get(mcpWriteEnabledKey).(string)
	return ok && v == "true"
}

func (m *MillMCPService) requireWriteEnabled() error {
	if !m.writeEnabled() {
		return fmt.Errorf("MCP write tools are disabled on this Mill instance -- a human must enable " +
			"\"Allow MCP clients to import data\" in Mill's own Settings page first (default-off by design, docs/adr/0017)")
	}
	return nil
}

type exportToolArgs struct {
	ID string `json:"id" jsonschema:"the entity's ID (list the matching mill:// index resource, or the matching export tool's index, to discover IDs)"`
}

type importToolArgs struct {
	JSON string `json:"json" jsonschema:"the entity definition as JSON -- the exact shape the matching export tool (or the UI's Export button) produces"`
}

type importToolResult struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

func textResult(text string) *mcp.CallToolResult {
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: text}}}
}

// registerTools wires the export/import tool set. Export tools are
// read-only and ungated; import tools all pass through
// requireWriteEnabled.
func (m *MillMCPService) registerTools() {
	mcp.AddTool(m.server, &mcp.Tool{
		Name:        "export_workflow",
		Description: "Export one workflow's full definition as JSON (same shape as the UI's Export button). Read-only.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in exportToolArgs) (*mcp.CallToolResult, any, error) {
		data, err := m.comp.ExportWorkflow(in.ID)
		if err != nil {
			return nil, nil, err
		}
		return textResult(data), nil, nil
	})

	mcp.AddTool(m.server, &mcp.Tool{
		Name:        "export_request",
		Description: "Export one HTTPRequest's full definition as JSON -- never includes a secret. Read-only.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in exportToolArgs) (*mcp.CallToolResult, any, error) {
		data, err := m.cfg.ExportHTTPRequest(in.ID)
		if err != nil {
			return nil, nil, err
		}
		return textResult(data), nil, nil
	})

	mcp.AddTool(m.server, &mcp.Tool{
		Name:        "export_list",
		Description: "Export one List's full definition (label + entries) as JSON. Read-only.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in exportToolArgs) (*mcp.CallToolResult, any, error) {
		data, err := m.cfg.ExportList(in.ID)
		if err != nil {
			return nil, nil, err
		}
		return textResult(data), nil, nil
	})

	mcp.AddTool(m.server, &mcp.Tool{
		Name:        "export_mcpserver",
		Description: "Export one configured MCP Server's definition as JSON. Read-only.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in exportToolArgs) (*mcp.CallToolResult, any, error) {
		data, err := m.cfg.ExportMCPServer(in.ID)
		if err != nil {
			return nil, nil, err
		}
		return textResult(data), nil, nil
	})

	mcp.AddTool(m.server, &mcp.Tool{
		Name: "import_workflow",
		Description: "Create a new workflow from an exported-workflow JSON definition. Always mints a new " +
			"workflow ID, never overwrites an existing one. Requires the human-set 'Allow MCP clients to " +
			"import data' toggle in Mill's Settings (default off).",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in importToolArgs) (*mcp.CallToolResult, importToolResult, error) {
		if err := m.requireWriteEnabled(); err != nil {
			return nil, importToolResult{}, err
		}
		wf, err := m.comp.ImportWorkflow(in.JSON)
		if err != nil {
			return nil, importToolResult{}, err
		}
		return nil, importToolResult{ID: wf.ID, Label: wf.Label}, nil
	})

	mcp.AddTool(m.server, &mcp.Tool{
		Name: "import_request",
		Description: "Create a new HTTPRequest from an exported-request JSON definition. The imported request " +
			"starts with no secret set (a human sets secrets in Mill's UI only). Requires the human-set " +
			"'Allow MCP clients to import data' toggle in Mill's Settings (default off).",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in importToolArgs) (*mcp.CallToolResult, importToolResult, error) {
		if err := m.requireWriteEnabled(); err != nil {
			return nil, importToolResult{}, err
		}
		r, err := m.cfg.ImportHTTPRequest(in.JSON)
		if err != nil {
			return nil, importToolResult{}, err
		}
		return nil, importToolResult{ID: r.ID, Label: r.Label}, nil
	})

	mcp.AddTool(m.server, &mcp.Tool{
		Name: "import_list",
		Description: "Create a new List from an exported-list JSON definition. Requires the human-set " +
			"'Allow MCP clients to import data' toggle in Mill's Settings (default off).",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in importToolArgs) (*mcp.CallToolResult, importToolResult, error) {
		if err := m.requireWriteEnabled(); err != nil {
			return nil, importToolResult{}, err
		}
		l, err := m.cfg.ImportList(in.JSON)
		if err != nil {
			return nil, importToolResult{}, err
		}
		return nil, importToolResult{ID: l.ID, Label: l.Label}, nil
	})

	mcp.AddTool(m.server, &mcp.Tool{
		Name: "import_mcpserver",
		Description: "Create a new configured MCP Server from an exported-mcpserver JSON definition. Requires " +
			"the human-set 'Allow MCP clients to import data' toggle in Mill's Settings (default off).",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in importToolArgs) (*mcp.CallToolResult, importToolResult, error) {
		if err := m.requireWriteEnabled(); err != nil {
			return nil, importToolResult{}, err
		}
		s, err := m.cfg.ImportMCPServer(in.JSON)
		if err != nil {
			return nil, importToolResult{}, err
		}
		return nil, importToolResult{ID: s.ID, Label: s.Label}, nil
	})
}
