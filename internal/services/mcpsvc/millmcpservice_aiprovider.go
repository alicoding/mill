package mcpsvc

import (
	"context"
	"fmt"

	"github.com/alicoding/mill/internal/services/configuresvc"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type aiProviderAvailabilityArgs struct {
	ProviderID string `json:"providerId" jsonschema:"the configured AI provider's ID"`
}

type cancelAIProviderCheckArgs struct {
	ProviderID string `json:"providerId" jsonschema:"the configured AI provider's ID"`
	CheckID    string `json:"checkId" jsonschema:"the active check ID returned by start_ai_provider_check"`
}

// registerAIProviderAvailabilityTools exposes the same Configure coordinator
// used by Wails. The start action performs its own guardrail request there;
// MCP adds no second approval or transport route.
func (m *MillMCPService) registerAIProviderAvailabilityTools() {
	mcp.AddTool(m.server, &mcp.Tool{
		Name:        "get_ai_provider_availability",
		Description: "Read cached machine-local availability evidence for one configured AI provider. Never reads a secret or calls the provider.",
		Annotations: readOnlyAnnotations,
	}, func(_ context.Context, _ *mcp.CallToolRequest, in aiProviderAvailabilityArgs) (*mcp.CallToolResult, any, error) {
		if m.cfg == nil {
			return nil, nil, fmt.Errorf("configure service is not available")
		}
		result, err := jsonResult(m.cfg.GetAIProviderAvailability(in.ProviderID))
		return result, nil, err
	})

	mcp.AddTool(m.server, &mcp.Tool{
		Name:        "start_ai_provider_check",
		Description: "Request a guarded metadata inspection for one configured AI provider. Returns promptly; poll get_ai_provider_availability with providerId for progress.",
		Annotations: executeAnnotations,
	}, func(_ context.Context, _ *mcp.CallToolRequest, in aiProviderAvailabilityArgs) (*mcp.CallToolResult, any, error) {
		if m.cfg == nil {
			return nil, nil, fmt.Errorf("configure service is not available")
		}
		result, err := jsonResult(configuresvc.StartAIProviderCheckWithActor(m.cfg, in.ProviderID, "mcp")) //nolint:contextcheck // The coordinator owns its asynchronous approval and request contexts.
		return result, nil, err
	})

	mcp.AddTool(m.server, &mcp.Tool{
		Name:        "cancel_ai_provider_check",
		Description: "Cancel one active provider check, including a pending approval or retry wait. Requires the exact providerId and checkId returned by start.",
		Annotations: editAnnotations,
	}, func(_ context.Context, _ *mcp.CallToolRequest, in cancelAIProviderCheckArgs) (*mcp.CallToolResult, any, error) {
		if m.cfg == nil {
			return nil, nil, fmt.Errorf("configure service is not available")
		}
		result, err := jsonResult(m.cfg.CancelAIProviderCheck(in.ProviderID, in.CheckID))
		return result, nil, err
	})
}
