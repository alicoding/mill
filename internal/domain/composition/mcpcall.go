package composition

import (
	"github.com/alicoding/mill/internal/domain/guardrail"

	"encoding/json"
	"fmt"
	"strings"

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

// callToolFn is the function an mcp-tool-call node actually invokes to
// run a tool -- defaults to mcpclient.CallTool, a real stdio subprocess
// (production's only path). Overridable in tests (SetMCPCallTool) so
// this node's own responsibility -- resolving the server, parsing/
// resolving arguments, applying the result to the payload -- can be
// proven end to end against a real, in-process MCP protocol transport
// (mcp.NewInMemoryTransports, mirroring internal/adapters/mcpclient's
// own test pattern, docs/goals/0010 item 5) without spawning a
// subprocess or touching npx/the network, the same "test against
// something real, minus the process boundary" bar SetHTTPRequestLookup's
// httptest.Server precedent already sets one layer up.
var callToolFn = mcpclient.CallTool

// SetMCPCallTool overrides how mcp-tool-call nodes actually perform a
// tool call -- test-only; production always uses the default
// (mcpclient.CallTool).
func SetMCPCallTool(fn func(command string, args []string, toolName string, arguments map[string]any) (string, error)) {
	callToolFn = fn
}

func init() {
	RegisterNodeType(NodeType{
		ID: "mcp-tool-call", Kind: KindProcess,
		Effect:      guardrail.ClassExternal,
		Complexity:  ComplexityAdvanced, // argumentsJSON needs the target tool's own input schema
		Consumes:    []PayloadKind{PayloadAny},
		Produces:    PayloadProduce{Kind: PayloadAny},
		Output:      "the tool's text result",
		Label:       "Call an MCP tool",
		Description: "Calls one tool on a Configure-authored MCP server and replaces the payload with its text result (docs/SPEC.md §3.6). mcpServerId is FieldText for the same reason integration-http's requestId is -- runtime, Configure-authored data (the Inspector renders a live picker for it, RefKind, docs/adr/0009); toolName is picked from the server's live tool list in the canvas Inspector (MCPToolArgsEditor.tsx), falling back to typing the exact name when the server can't be reached.",
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
				Multiline:   true,
				Description: "Optional JSON object of arguments to pass to the tool. Top-level string values of the form \"attr:<name>\" resolve to the named Attribute's typed value at run time (a number/boolean Attribute stays a JSON number/boolean, not stringified); every other value is sent as-is.",
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
		arguments = resolveMCPArguments(arguments, ctx.Attributes)

		result, err := callToolFn(rs.Command, rs.Args, node.Config["toolName"], arguments)
		if err != nil {
			return ctx, fmt.Errorf("mcp-tool-call: %w", err)
		}
		ctx.Payload = result
		return ctx, nil
	})
}

// resolveMCPArguments resolves an mcp-tool-call node's parsed arguments
// against the running Attributes bag -- deliberately its own function
// rather than reusing resolveBindingValue (attributebinding.go), since
// MCP tool arguments are structured JSON (a tool's inputSchema can
// declare a number/boolean/object field) while resolveBindingValue's
// callers (integration-http's path/query/header/body bindings) are all
// flat strings on the wire. Only TOP-LEVEL string values carrying the
// "attr:<name>" prefix are resolved -- a nested object/array value, a
// non-string value, or a plain string with no prefix passes through
// untouched, same permissive "resolve what's explicitly marked, leave
// everything else alone" shape as resolveBindingValue. A missing
// Attribute resolves to "" (the package's own permissive precedent for
// an unset value, see resolveBindingValue's doc comment) rather than
// erroring. Returns a new map; never mutates the input.
func resolveMCPArguments(arguments map[string]any, attrs map[string]any) map[string]any {
	if arguments == nil {
		return nil
	}
	out := make(map[string]any, len(arguments))
	for k, v := range arguments {
		s, ok := v.(string)
		if !ok {
			out[k] = v
			continue
		}
		name, ok := strings.CutPrefix(s, attrBindingPrefix)
		if !ok {
			out[k] = v
			continue
		}
		if resolved, ok := attrs[name]; ok {
			out[k] = resolved
		} else {
			out[k] = ""
		}
	}
	return out
}
