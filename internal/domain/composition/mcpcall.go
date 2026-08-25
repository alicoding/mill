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
	// Env is already fully resolved (any vault: reference substituted
	// for its real value) by whatever set lookupMCPServerFn -- this
	// package never sees or interprets a vault reference itself (the
	// node-standard credential rule: composition never reads a secret
	// out of Node.Config or resolves one itself).
	Env []string
}

// lookupMCPServerFn defaults to erroring so an mcp-tool-call node run
// before ConfigureService exists (or before SetMCPServerLookup wires it)
// fails loudly instead of silently no-op'ing. Takes a SecretAccessRun
// (goal 0203 S3) so the resolver on the other side of this seam can
// attribute the MCP server's own "vault:" env resolution to the run
// that triggered it.
var lookupMCPServerFn = func(mcpServerID string, _ SecretAccessRun) (ResolvedMCPServer, error) {
	return ResolvedMCPServer{}, fmt.Errorf("no MCP server lookup registered (yet) for id %q", mcpServerID)
}

// SetMCPServerLookup wires the function mcp-tool-call nodes use to
// resolve an mcpServerId into its command/args. Called once from
// main.go once ConfigureService exists.
func SetMCPServerLookup(fn func(mcpServerID string, run SecretAccessRun) (ResolvedMCPServer, error)) {
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
func SetMCPCallTool(fn func(command string, args []string, env []string, toolName string, arguments map[string]any, callerIdentity string) (string, error)) {
	callToolFn = fn
}

// redactSecretsFn defaults to identity (no-op) so a run before
// SetSecretRedactor is wired (or a headless `go test` that never wires
// it) still works, just without redaction -- same fail-open-to-
// unwired-behavior shape lookupMCPServerFn's own error default takes
// the opposite way (fails loud) because THAT gap means "nothing would
// work at all," while this one means "one extra safety net is
// missing," not a correctness break.
var redactSecretsFn = func(s string) string { return s }

// SetSecretRedactor wires the function that scrubs known vault secret
// values out of an mcp-tool-call node's own error text (goal 0185 S4)
// -- called once from main.go once secretsvc.SecretService exists
// (secretsvc.SecretService.RedactKnownSecrets).
func SetSecretRedactor(fn func(string) string) {
	redactSecretsFn = fn
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
		Description: "Calls one tool on a configured MCP server and replaces the payload with its text result. The tool is picked from the server's live tool list, with typed-name fallback when the server can't be reached.",
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
		rs, err := lookupMCPServerFn(node.Config["mcpServerId"], secretAccessRunFromCtx(ctx))
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

		result, err := callToolFn(rs.Command, rs.Args, rs.Env, node.Config["toolName"], arguments, node.ID)
		if err != nil {
			// A server launched with an injected vault secret (rs.Env)
			// could echo it back in its own failure text (an auth error
			// naming the bad token, say) -- redactSecretsFn scrubs every
			// currently-known vault value before the error leaves this
			// node (goal 0185 S4).
			return ctx, fmt.Errorf("mcp-tool-call: %s", redactSecretsFn(err.Error()))
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
