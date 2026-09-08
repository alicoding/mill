package mcpsvc

import (
	"context"
	"fmt"
	"sort"

	"github.com/alicoding/mill/internal/adapters/settings"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Tools lists every tool this server currently advertises, sorted by
// name, through the SDK's own tools/list over an in-memory transport
// -- the server keeps its tool table private, so the protocol is the
// one honest door to it. Returns the SDK's own *mcp.Tool (name,
// description, schema, and Annotations) rather than a Mill-specific
// projection, so a caller checking annotations (goal 0388) sees
// exactly what a real client would.
func (m *MillMCPService) Tools(ctx context.Context) ([]*mcp.Tool, error) {
	clientTransport, serverTransport := mcp.NewInMemoryTransports()
	serverSession, err := m.server.Connect(ctx, serverTransport, nil)
	if err != nil {
		return nil, fmt.Errorf("mcp tools: connect server: %w", err)
	}
	defer func() { _ = serverSession.Close() }()
	client := mcp.NewClient(&mcp.Implementation{Name: "mill-tool-inventory", Version: m.version}, nil)
	session, err := client.Connect(ctx, clientTransport, nil)
	if err != nil {
		return nil, fmt.Errorf("mcp tools: connect client: %w", err)
	}
	defer func() { _ = session.Close() }()
	var tools []*mcp.Tool
	for tool, err := range session.Tools(ctx, nil) {
		if err != nil {
			return nil, fmt.Errorf("mcp tools: list: %w", err)
		}
		tools = append(tools, tool)
	}
	sort.Slice(tools, func(i, j int) bool { return tools[i].Name < tools[j].Name })
	return tools, nil
}

// ToolNames is Tools' own name-only projection -- every existing
// caller (docsgen's tool listing, the inventory tests) wants only the
// name, sorted.
func (m *MillMCPService) ToolNames(ctx context.Context) ([]string, error) {
	tools, err := m.Tools(ctx)
	if err != nil {
		return nil, err
	}
	names := make([]string, len(tools))
	for i, t := range tools {
		names[i] = t.Name
	}
	return names, nil
}

// BuiltInToolNames is the tool inventory of a bare server -- every
// tool Mill itself registers, before any plugin adds its own. store
// backs the write-gate read the constructor performs; an empty
// in-memory one is enough. The listing runs against a server this call
// owns entirely, so it carries no caller context to thread through.
func BuiltInToolNames(store settings.Store) ([]string, error) {
	return NewMillMCPService("inventory", nil, nil, store, nil).ToolNames(context.Background())
}

// BuiltInTools is BuiltInToolNames' full-object counterpart -- same
// bare server, same connect-through-the-real-protocol contract, but
// every tool's whole registration (including Annotations) rather than
// only its name.
func BuiltInTools(store settings.Store) ([]*mcp.Tool, error) {
	return NewMillMCPService("inventory", nil, nil, store, nil).Tools(context.Background())
}
