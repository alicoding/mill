package mcpsvc

import (
	"context"
	"encoding/json"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type aiProviderIDArgs struct {
	ProviderID string `json:"providerId" jsonschema:"the configured AI provider's ID (read mill://aiproviders to discover IDs)"`
}

type applyAIProviderImportArgs struct {
	JSON             string `json:"json" jsonschema:"the AI provider definition reviewed by preview_aiprovider_import"`
	ExpectedRevision string `json:"expectedRevision" jsonschema:"the exact expectedRevision returned by preview_aiprovider_import"`
}

// registerAIProviderTools exposes the same passive impact/import review and
// guarded mutations as Configure. Apply keeps the preview revision in its
// parked payload, so approval cannot silently replace a provider changed in
// the meantime.
func (m *MillMCPService) registerAIProviderTools() {
	m.registerAIProviderReadTools()
	m.registerAIProviderImportTool()
	m.registerAIProviderApplyImportTool()
}

func (m *MillMCPService) registerAIProviderReadTools() {
	mcp.AddTool(m.server, &mcp.Tool{
		Name:        "export_aiprovider",
		Description: "Export the stored AI provider connection fields as JSON, including its address and key-reference name. Does not resolve the referenced secret. Read-only.",
		Annotations: readOnlyAnnotations,
	}, func(_ context.Context, _ *mcp.CallToolRequest, in aiProviderIDArgs) (*mcp.CallToolResult, any, error) {
		data, err := m.cfg.ExportAIProvider(in.ProviderID)
		if err != nil {
			return nil, nil, err
		}
		return textResult(data), nil, nil
	})

	mcp.AddTool(m.server, &mcp.Tool{
		Name: "get_aiprovider_change_impact",
		Description: "Check whether unfinished runs currently block changes to one configured AI provider. " +
			"Returns execution evidence separately from authored references. Read-only.",
		Annotations: readOnlyAnnotations,
	}, func(_ context.Context, _ *mcp.CallToolRequest, in aiProviderIDArgs) (*mcp.CallToolResult, any, error) {
		text, err := jsonText(m.cfg.GetAIProviderChangeImpact(in.ProviderID))
		if err != nil {
			return nil, nil, err
		}
		return textResult(text), nil, nil
	})

	mcp.AddTool(m.server, &mcp.Tool{
		Name: "preview_aiprovider_import",
		Description: "Validate and preview an AI provider import without resolving its key, contacting its endpoint, or changing data. " +
			"Returns current and proposed safe fields, authored references, execution impact, and an expected revision. Read-only.",
		Annotations: readOnlyAnnotations,
	}, func(_ context.Context, _ *mcp.CallToolRequest, in importToolArgs) (*mcp.CallToolResult, any, error) {
		preview, err := m.cfg.PreviewAIProviderImport(in.JSON)
		if err != nil {
			return nil, nil, err
		}
		text, err := jsonText(preview)
		if err != nil {
			return nil, nil, err
		}
		return textResult(text), nil, nil
	})
}

func (m *MillMCPService) registerAIProviderImportTool() {
	m.registerWriteExecutor("import_aiprovider", func(argsJSON string) (string, error) {
		var in importToolArgs
		if err := json.Unmarshal([]byte(argsJSON), &in); err != nil {
			return "", err
		}
		provider, err := m.cfg.ImportAIProvider(in.JSON)
		if err != nil {
			return "", err
		}
		return jsonText(importToolResult{ID: provider.ID, Label: provider.Label})
	})
	mcp.AddTool(m.server, &mcp.Tool{
		Name: "import_aiprovider",
		Description: "Create or replace a configured AI provider from JSON through the ordinary active-run safety check. " +
			"Use preview_aiprovider_import and apply_aiprovider_import when a review step is available. Requires the human-set " +
			"'Allow MCP clients to change content' toggle and may park pending approval.",
		Annotations: mixedAnnotations,
	}, func(_ context.Context, _ *mcp.CallToolRequest, in importToolArgs) (*mcp.CallToolResult, any, error) {
		if err := m.requireWriteEnabled(); err != nil {
			return nil, nil, err
		}
		argsJSON, err := marshalArgs(in)
		if err != nil {
			return nil, nil, err
		}
		result, err := m.gateWrite("import_aiprovider", "An MCP client wants to import an AI provider connection", argsJSON)
		return result, nil, err
	})
}

func (m *MillMCPService) registerAIProviderApplyImportTool() {
	m.registerWriteExecutor("apply_aiprovider_import", func(argsJSON string) (string, error) {
		var in applyAIProviderImportArgs
		if err := json.Unmarshal([]byte(argsJSON), &in); err != nil {
			return "", err
		}
		provider, err := m.cfg.ApplyAIProviderImport(in.JSON, in.ExpectedRevision)
		if err != nil {
			return "", err
		}
		return jsonText(importToolResult{ID: provider.ID, Label: provider.Label})
	})
	mcp.AddTool(m.server, &mcp.Tool{
		Name: "apply_aiprovider_import",
		Description: "Apply an AI provider import only if its target still matches preview_aiprovider_import's expected revision, " +
			"then recheck unfinished-run safety. Requires the human-set 'Allow MCP clients to change content' toggle and may park " +
			"pending approval; a provider changed while approval was pending is refused as stale.",
		Annotations: mixedAnnotations,
	}, func(_ context.Context, _ *mcp.CallToolRequest, in applyAIProviderImportArgs) (*mcp.CallToolResult, any, error) {
		if err := m.requireWriteEnabled(); err != nil {
			return nil, nil, err
		}
		argsJSON, err := marshalArgs(in)
		if err != nil {
			return nil, nil, err
		}
		result, err := m.gateWrite("apply_aiprovider_import", "An MCP client wants to apply a reviewed AI provider import", argsJSON)
		return result, nil, err
	})
}
