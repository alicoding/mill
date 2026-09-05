package mcpsvc

import (
	"context"
	"fmt"
	"sort"

	"github.com/alicoding/mill/internal/adapters/settings"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// ToolNames lists every tool this server currently advertises, sorted,
// through the SDK's own tools/list over an in-memory transport -- the
// server keeps its tool table private, so the protocol is the one
// honest door to it.
func (m *MillMCPService) ToolNames(ctx context.Context) ([]string, error) {
	clientTransport, serverTransport := mcp.NewInMemoryTransports()
	serverSession, err := m.server.Connect(ctx, serverTransport, nil)
	if err != nil {
		return nil, fmt.Errorf("mcp tool names: connect server: %w", err)
	}
	defer func() { _ = serverSession.Close() }()
	client := mcp.NewClient(&mcp.Implementation{Name: "mill-tool-inventory", Version: m.version}, nil)
	session, err := client.Connect(ctx, clientTransport, nil)
	if err != nil {
		return nil, fmt.Errorf("mcp tool names: connect client: %w", err)
	}
	defer func() { _ = session.Close() }()
	var names []string
	for tool, err := range session.Tools(ctx, nil) {
		if err != nil {
			return nil, fmt.Errorf("mcp tool names: list: %w", err)
		}
		names = append(names, tool.Name)
	}
	sort.Strings(names)
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
