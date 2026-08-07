package mcpclient

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// testServer wires a tiny in-process MCP server exposing one "greet"
// tool, connected to a client-side transport via mcp.NewInMemoryTransports
// -- a real MCP protocol round-trip, no subprocess spawned, the same
// "test against something real, not a mock" bar httpconnector's own
// httptest.Server-backed tests already set.
type greetArgs struct {
	Name string `json:"name"`
}

func testServerTransport(t *testing.T) mcp.Transport {
	t.Helper()
	server := mcp.NewServer(&mcp.Implementation{Name: "test-server", Version: "v0"}, nil)
	mcp.AddTool(server, &mcp.Tool{Name: "greet", Description: "say hi"},
		func(_ context.Context, _ *mcp.CallToolRequest, args greetArgs) (*mcp.CallToolResult, any, error) {
			return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: "Hi " + args.Name}}}, nil, nil
		},
	)

	serverTransport, clientTransport := mcp.NewInMemoryTransports()
	ctx := context.Background()
	if _, err := server.Connect(ctx, serverTransport, nil); err != nil {
		t.Fatalf("server.Connect returned error: %v", err)
	}
	return clientTransport
}

func TestListTools_ReturnsRealTool(t *testing.T) {
	ctx := context.Background()
	tools, err := listTools(ctx, testServerTransport(t))
	if err != nil {
		t.Fatalf("listTools returned error: %v", err)
	}
	if len(tools) != 1 {
		t.Fatalf("listTools returned %d tools, want 1", len(tools))
	}
	if tools[0].Name != "greet" {
		t.Errorf("tools[0].Name = %q, want %q", tools[0].Name, "greet")
	}
	if tools[0].Description != "say hi" {
		t.Errorf("tools[0].Description = %q, want %q", tools[0].Description, "say hi")
	}
	var schema map[string]any
	if err := json.Unmarshal(tools[0].InputSchema, &schema); err != nil {
		t.Errorf("InputSchema did not unmarshal as JSON: %v (raw: %s)", err, tools[0].InputSchema)
	}
}

func TestCallTool_ReturnsRealTextResult(t *testing.T) {
	ctx := context.Background()
	result, err := callTool(ctx, testServerTransport(t), "greet", map[string]any{"name": "World"})
	if err != nil {
		t.Fatalf("callTool returned error: %v", err)
	}
	if result != "Hi World" {
		t.Errorf("callTool result = %q, want %q", result, "Hi World")
	}
}

func TestCallTool_UnknownTool_Rejected(t *testing.T) {
	ctx := context.Background()
	if _, err := callTool(ctx, testServerTransport(t), "does-not-exist", nil); err == nil {
		t.Fatal("callTool with an unknown tool name returned nil error, want an error")
	}
}

func TestContentText_JoinsMultipleTextParts(t *testing.T) {
	got := contentText([]mcp.Content{&mcp.TextContent{Text: "a"}, &mcp.TextContent{Text: "b"}})
	if got != "a\nb" {
		t.Errorf("contentText joined = %q, want %q", got, "a\nb")
	}
}

func TestContentText_IgnoresNonTextContent(t *testing.T) {
	got := contentText([]mcp.Content{&mcp.TextContent{Text: "only this"}, &mcp.ImageContent{Data: []byte("x"), MIMEType: "image/png"}})
	if !strings.Contains(got, "only this") {
		t.Errorf("contentText = %q, want it to contain the text part", got)
	}
}
