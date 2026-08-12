// Package mcpclient wraps modelcontextprotocol/go-sdk's MCP *client* role
// behind Mill's own names, per CLAUDE.md's ports/adapters rule -- callers
// never import mcp.* types directly. Confirmed directly against the SDK's
// own docs before writing this (docs/SPEC.md §3.6): Mill acts as a
// protocol client making one deterministic tool call per workflow step,
// the same shape internal/adapters/httpconnector already has for HTTP --
// not an MCP host running an agent's tool-selection loop, so this never
// touches §1.1's "not an LLM client" rule.
package mcpclient

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// timeout bounds every connect+call -- same reasoning and value as
// httpconnector's own constant: an unbounded local subprocess call is
// the opposite of Mill's fail-safe guardrail posture (docs/SPEC.md §8).
const timeout = 30 * time.Second

// Tool is one tool a configured MCP server exposes -- Mill's own shape,
// not mcp.Tool, so a caller (ConfigureService) never needs the SDK type.
type Tool struct {
	Name        string
	Description string
	// InputSchema is the tool's raw JSON Schema, shown as-is in Configure
	// (docs/SPEC.md §3.6's "List tools" reference view) -- Mill doesn't
	// interpret it, so there's nothing to lose by keeping it opaque.
	InputSchema json.RawMessage
}

var clientImpl = &mcp.Implementation{Name: "mill", Version: "v1"}

// ListTools connects to the MCP server run by command+args over stdio,
// lists every tool it exposes, and disconnects.
func ListTools(command string, args []string) ([]Tool, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	// command/args are the user's own MCP-server-connector configuration
	// (Configure), the deliberate feature -- launching a user-chosen
	// executable, the same class as shellenv's own login-shell launch.
	// exec.Command never invokes a shell (argv is passed directly to
	// execve), so there's no shell-metacharacter injection surface
	// either; the risk here is "runs what the user configured," which is
	// the intended behavior, not a vulnerability to close.
	transport := &mcp.CommandTransport{Command: exec.CommandContext(ctx, command, args...)} //nolint:gosec // user-configured connector command, by design (see comment above)
	return listTools(ctx, transport)
}

// CallTool connects to the MCP server run by command+args over stdio,
// calls toolName with arguments, and returns every text content part of
// the result, newline-joined -- non-text content types are real future
// work, not needed for a first working version (same "don't build ahead
// of a real need" reasoning as httpconnector's own response shape).
func CallTool(command string, args []string, toolName string, arguments map[string]any) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	// command/args are the user's own MCP-server-connector configuration
	// (Configure), the deliberate feature -- launching a user-chosen
	// executable, the same class as shellenv's own login-shell launch.
	// exec.Command never invokes a shell (argv is passed directly to
	// execve), so there's no shell-metacharacter injection surface
	// either; the risk here is "runs what the user configured," which is
	// the intended behavior, not a vulnerability to close.
	transport := &mcp.CommandTransport{Command: exec.CommandContext(ctx, command, args...)} //nolint:gosec // user-configured connector command, by design (see comment above)
	return callTool(ctx, transport, toolName, arguments)
}

// listTools/callTool are the unexported core the exported functions
// above delegate to -- tests call these directly with an in-memory
// transport (mcp.NewInMemoryTransports), exercising the real MCP
// protocol round-trip without spawning a subprocess, the same "test
// against something real" bar httpconnector's own httptest.Server-backed
// tests already set.
func listTools(ctx context.Context, transport mcp.Transport) ([]Tool, error) {
	session, err := connect(ctx, transport)
	if err != nil {
		return nil, err
	}
	defer func() { _ = session.Close() }()

	result, err := session.ListTools(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("listing tools: %w", err)
	}

	tools := make([]Tool, 0, len(result.Tools))
	for _, t := range result.Tools {
		schema, err := json.Marshal(t.InputSchema)
		if err != nil {
			return nil, fmt.Errorf("marshaling input schema for tool %q: %w", t.Name, err)
		}
		tools = append(tools, Tool{Name: t.Name, Description: t.Description, InputSchema: schema})
	}
	return tools, nil
}

func callTool(ctx context.Context, transport mcp.Transport, toolName string, arguments map[string]any) (string, error) {
	session, err := connect(ctx, transport)
	if err != nil {
		return "", err
	}
	defer func() { _ = session.Close() }()

	result, err := session.CallTool(ctx, &mcp.CallToolParams{Name: toolName, Arguments: arguments})
	if err != nil {
		return "", fmt.Errorf("calling tool %q: %w", toolName, err)
	}
	if result.IsError {
		return "", fmt.Errorf("tool %q returned an error: %s", toolName, contentText(result.Content))
	}
	return contentText(result.Content), nil
}

func connect(ctx context.Context, transport mcp.Transport) (*mcp.ClientSession, error) {
	client := mcp.NewClient(clientImpl, nil)
	session, err := client.Connect(ctx, transport, nil)
	if err != nil {
		return nil, fmt.Errorf("connecting to MCP server: %w", err)
	}
	return session, nil
}

func contentText(content []mcp.Content) string {
	var parts []string
	for _, c := range content {
		if tc, ok := c.(*mcp.TextContent); ok {
			parts = append(parts, tc.Text)
		}
	}
	return strings.Join(parts, "\n")
}
