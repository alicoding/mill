package composition

import (
	"encoding/json"
	"fmt"

	"github.com/alicoding/mill/internal/adapters/mcpclient"
)

// ResolvedMCPServer is an MCP Server's connection config, assembled by
// whatever owns MCPServer storage at request time. Same shape and
// reasoning as ResolvedHTTPRequest (integration.go): composition.go
// doesn't own MCPServer persistence (ConfigureService does), so this is
// injected once via SetMCPServerLookup rather than composition
// depending on ConfigureService directly.
type ResolvedMCPServer struct {
	Command string
	Args    []string
}

// lookupMCPServerFn defaults to erroring so an mcp-tool-call node run
// before ConfigureService exists (or before SetMCPServerLookup wires it)
// fails loudly instead of silently no-op'ing.
var lookupMCPServerFn = func(mcpServerID string) (ResolvedMCPServer, error) {
	return ResolvedMCPServer{}, fmt.Errorf("no MCP server lookup registered (yet) for id %q", mcpServerID)
}

// SetMCPServerLookup wires the function mcp-tool-call nodes use to
// resolve an mcpServerId into its command/args. Called once from
// main.go once ConfigureService exists.
func SetMCPServerLookup(fn func(mcpServerID string) (ResolvedMCPServer, error)) {
	lookupMCPServerFn = fn
}

func init() {
	RegisterNodeType(NodeType{
		ID: "mcp-tool-call", Kind: KindProcess,
		Label:       "MCP: tool call",
		Description: "Calls one tool on a Configure-authored MCP server and replaces the payload with its text result (docs/SPEC.md §3.6). mcpServerId is FieldText for the same reason integration-http's requestId is -- runtime, Configure-authored data (the Inspector renders a live picker for it, RefKind, docs/adr/0009); toolName stays plain text -- use the Configure page's \"List tools\" button on the server to find the exact toolName and its expected arguments.",
		ConfigFields: []ConfigField{
			{
				Key: "mcpServerId", Label: "MCP Server ID",
				Description: "The ID of an MCP server configured on the Configure page.",
				Default:     "", Type: FieldText, RefKind: "mcpserver",
			},
			{
				Key: "toolName", Label: "Tool name",
				Description: "The exact tool name, from that server's own tool list.",
				Default:     "", Type: FieldText,
			},
			{
				Key: "argumentsJSON", Label: "Arguments (JSON)",
				Description: "Optional JSON object of arguments to pass to the tool, sent as-is.",
				Default:     "", Type: FieldText,
			},
		},
	}, func(node Node, ctx ExecContext) (ExecContext, error) {
		rs, err := lookupMCPServerFn(node.Config["mcpServerId"])
		if err != nil {
			return ctx, fmt.Errorf("mcp-tool-call: %w", err)
		}

		var arguments map[string]any
		if raw := node.Config["argumentsJSON"]; raw != "" {
			if err := json.Unmarshal([]byte(raw), &arguments); err != nil {
				return ctx, fmt.Errorf("mcp-tool-call: invalid argumentsJSON: %w", err)
			}
		}

		result, err := mcpclient.CallTool(rs.Command, rs.Args, node.Config["toolName"], arguments)
		if err != nil {
			return ctx, fmt.Errorf("mcp-tool-call: %w", err)
		}
		ctx.Payload = result
		return ctx, nil
	})
}
