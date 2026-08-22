package mcpsvc

import (
	"path/filepath"
	"testing"

	"github.com/alicoding/mill/internal/adapters/mcpaudit"
	"github.com/alicoding/mill/internal/adapters/mcpclient"
	"github.com/alicoding/mill/internal/services/atlassvc"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/configuresvc"
	"github.com/alicoding/mill/internal/services/mcpauditsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// TestConnectInMemoryClient_AgentLoopSessionAuditedBothDirections is the
// design contract's own required proof (goal 0159 slice 1): the agent
// loop reaches Mill's own MCP server via ConnectInMemoryClient, which
// now builds its client through mcpclient.NewClient -- the SAME choke
// point every other client connection in Mill goes through. Wiring
// both the server's ServerMiddleware (AddReceivingMiddleware) and
// mcpclient's package-level SetSendingMiddleware (ClientMiddleware)
// before connecting, then making one real tool call over the in-memory
// session, must produce TWO audit rows for that call -- one
// direction=client (Mill, as the calling client) and one
// direction=server (Mill's own server, receiving it) -- with no
// special-cased code path for the agent loop anywhere in this chain.
func TestConnectInMemoryClient_AgentLoopSessionAuditedBothDirections(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "execution.db")
	audit, err := mcpauditsvc.New(dbPath, nil)
	if err != nil {
		t.Fatalf("mcpauditsvc.New: %v", err)
	}
	t.Cleanup(func() { _ = audit.Close() })

	mcpclient.SetSendingMiddleware(audit.ClientMiddleware())
	t.Cleanup(func() { mcpclient.SetSendingMiddleware() })

	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	cfg := configuresvc.NewConfigureService(store, comp, servicetest.FakeCredentialStore{})
	atlasSvc := atlassvc.NewAtlasService(store)

	svc := NewMillMCPService("0.0.0-test", comp, cfg, store, nil, audit.ServerMiddleware())
	svc.SetAtlasService(atlasSvc)

	ctx := t.Context()
	session, err := svc.ConnectInMemoryClient(ctx, "agentloop-audit-test")
	if err != nil {
		t.Fatalf("ConnectInMemoryClient: %v", err)
	}
	defer func() { _ = session.Close() }()

	res, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "atlas_list_kinds"})
	if err != nil {
		t.Fatalf("atlas_list_kinds: transport error: %v", err)
	}
	if res.IsError {
		t.Fatalf("atlas_list_kinds: tool error: %+v", res.Content)
	}

	resp, err := audit.ListMCPCalls(mcpauditsvc.ListMCPCallsRequest{Limit: 10})
	if err != nil {
		t.Fatalf("ListMCPCalls: %v", err)
	}
	var sawServer, sawClient bool
	for _, r := range resp.Records {
		if r.ToolName != "atlas_list_kinds" {
			continue
		}
		if r.Direction == string(mcpaudit.DirectionServer) {
			sawServer = true
		}
		if r.Direction == string(mcpaudit.DirectionClient) {
			sawClient = true
		}
	}
	if !sawServer {
		t.Errorf("agent-loop tool call never produced a direction=server audit row -- ConnectInMemoryClient's server side isn't covered")
	}
	if !sawClient {
		t.Errorf("agent-loop tool call never produced a direction=client audit row -- ConnectInMemoryClient's client session isn't covered by mcpclient's sending middleware")
	}
}
