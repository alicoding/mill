package composition

import (
	"context"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// TestSeededMCPExample_EchoToolCall_RunsEndToEnd proves the real seeded
// "Example: MCP echo call" workflow's mcp-tool-call node end to end
// (docs/goals/0010 item 5) against a real, in-process MCP protocol
// round trip -- mcp.NewInMemoryTransports, the exact fixture pattern
// internal/adapters/mcpclient's own tests already use -- never a
// subprocess, npx, or the network. SetMCPServerLookup still resolves
// the seed's REAL Command/Args (npx + the official reference server),
// proving that seed data is correct; SetMCPCallTool substitutes the
// actual call for a real in-memory MCP server exposing the same "echo"
// tool the seed's own toolName targets, matching the real reference
// server's documented behavior (docs/SPEC.md §3.6: {"message":"hello
// from mill"} -> "Echo: hello from mill", independently verified live
// against the real npx-spawned server when this was designed).
func TestSeededMCPExample_EchoToolCall_RunsEndToEnd(t *testing.T) {
	origLookup := lookupMCPServerFn
	origCall := callToolFn
	t.Cleanup(func() { lookupMCPServerFn = origLookup; callToolFn = origCall })

	var gotID string
	SetMCPServerLookup(func(id string) (ResolvedMCPServer, error) {
		gotID = id
		return ResolvedMCPServer{Command: "npx", Args: []string{"-y", "@modelcontextprotocol/server-everything"}}, nil
	})

	// A tiny in-process MCP server exposing one "echo" tool, connected
	// via an in-memory transport -- no subprocess anywhere.
	type echoArgs struct {
		Message string `json:"message"`
	}
	server := mcp.NewServer(&mcp.Implementation{Name: "fixture", Version: "v0"}, nil)
	mcp.AddTool(server, &mcp.Tool{Name: "echo", Description: "echoes the message back"},
		func(_ context.Context, _ *mcp.CallToolRequest, args echoArgs) (*mcp.CallToolResult, any, error) {
			return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: "Echo: " + args.Message}}}, nil, nil
		},
	)
	serverTransport, clientTransport := mcp.NewInMemoryTransports()
	ctx := context.Background()
	if _, err := server.Connect(ctx, serverTransport, nil); err != nil {
		t.Fatalf("server.Connect: %v", err)
	}

	var gotCommand string
	var gotArgs []string
	SetMCPCallTool(func(command string, args []string, toolName string, arguments map[string]any, callerIdentity string) (string, error) {
		gotCommand, gotArgs = command, args
		client := mcp.NewClient(&mcp.Implementation{Name: "mill-test", Version: "v1"}, nil)
		session, err := client.Connect(ctx, clientTransport, nil)
		if err != nil {
			return "", err
		}
		defer func() { _ = session.Close() }()
		result, err := session.CallTool(ctx, &mcp.CallToolParams{Name: toolName, Arguments: arguments})
		if err != nil {
			return "", err
		}
		var text string
		for _, c := range result.Content {
			if tc, ok := c.(*mcp.TextContent); ok {
				text += tc.Text
			}
		}
		return text, nil
	})

	var wf Workflow
	for _, w := range BuiltInWorkflows() {
		if w.Label == "Example: MCP echo call" {
			wf = w
		}
	}
	if wf.ID == "" {
		t.Fatal(`no built-in workflow labeled "Example: MCP echo call"`)
	}

	result, err := ExecuteWorkflow(wf.Nodes, wf.Edges, wf.Attributes)
	if err != nil {
		t.Fatalf("ExecuteWorkflow returned error: %v", err)
	}
	if result != "Echo: hello from mill" {
		t.Errorf("ExecuteWorkflow result = %q, want %q", result, "Echo: hello from mill")
	}
	if gotID == "" {
		t.Error("SetMCPServerLookup was never called with the seed's mcpServerId")
	}
	if gotCommand != "npx" || len(gotArgs) == 0 {
		t.Errorf("callToolFn received command=%q args=%v, want the seed's real npx/server-everything config", gotCommand, gotArgs)
	}
}
