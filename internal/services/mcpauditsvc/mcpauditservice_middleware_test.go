package mcpauditsvc

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/alicoding/mill/internal/adapters/mcpaudit"
	"github.com/alicoding/mill/internal/adapters/mcpauditstore"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func newTestService(t *testing.T) *MCPAuditService {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "execution.db")
	s, err := New(dbPath, nil)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

type emptyArgs struct{}

// openArgs accepts any JSON object -- ok_tool uses this (rather than
// emptyArgs) specifically so a test can pass a real, non-empty
// Arguments object and observe a positive ArgBytes without the SDK's
// generated strict schema rejecting it as an "unexpected additional
// property".
type openArgs map[string]any

func errorResult(text string) (*mcp.CallToolResult, emptyArgs, error) {
	return &mcp.CallToolResult{IsError: true, Content: []mcp.Content{&mcp.TextContent{Text: text}}}, emptyArgs{}, nil
}

// buildTestServer registers three tools -- an ordinary success, an
// ordinary tool-level error, and one that returns gateWrite's own
// canonical parked-pending text (simulating a park-and-poll write
// without pulling in the whole mcpsvc package) -- and wires audit's
// ServerMiddleware via AddReceivingMiddleware.
func buildTestServer(audit *MCPAuditService) *mcp.Server {
	server := mcp.NewServer(&mcp.Implementation{Name: "mill-test-server", Version: "v1"}, nil)
	server.AddReceivingMiddleware(audit.ServerMiddleware())
	mcp.AddTool(server, &mcp.Tool{Name: "ok_tool"}, func(_ context.Context, _ *mcp.CallToolRequest, _ openArgs) (*mcp.CallToolResult, openArgs, error) {
		return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: "all good"}}}, nil, nil
	})
	mcp.AddTool(server, &mcp.Tool{Name: "failing_tool"}, func(_ context.Context, _ *mcp.CallToolRequest, _ emptyArgs) (*mcp.CallToolResult, emptyArgs, error) {
		return errorResult("boom")
	})
	mcp.AddTool(server, &mcp.Tool{Name: "parking_tool"}, func(_ context.Context, _ *mcp.CallToolRequest, _ emptyArgs) (*mcp.CallToolResult, emptyArgs, error) {
		return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: mcpaudit.ParkedPendingText("write-abc")}}}, emptyArgs{}, nil
	})
	return server
}

func connectPlainClient(t *testing.T, ctx context.Context, server *mcp.Server, sendingMiddleware ...mcp.Middleware) *mcp.ClientSession {
	t.Helper()
	clientTransport, serverTransport := mcp.NewInMemoryTransports()
	if _, err := server.Connect(ctx, serverTransport, nil); err != nil {
		t.Fatalf("server.Connect: %v", err)
	}
	client := mcp.NewClient(&mcp.Implementation{Name: "mill-test-client", Version: "v9"}, nil)
	if len(sendingMiddleware) > 0 {
		client.AddSendingMiddleware(sendingMiddleware...)
	}
	session, err := client.Connect(ctx, clientTransport, nil)
	if err != nil {
		t.Fatalf("client.Connect: %v", err)
	}
	t.Cleanup(func() { _ = session.Close() })
	return session
}

// --- ServerMiddleware (AddReceivingMiddleware) ---

func TestServerMiddleware_RecordsSuccessfulToolCall(t *testing.T) {
	audit := newTestService(t)
	server := buildTestServer(audit)
	ctx := t.Context()
	session := connectPlainClient(t, ctx, server)

	if _, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "ok_tool"}); err != nil {
		t.Fatalf("CallTool: %v", err)
	}

	records, total, err := audit.store.List(mcpauditstore.Filter{}, 10, 0)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if total != 1 {
		t.Fatalf("total = %d, want 1", total)
	}
	r := records[0]
	if r.Direction != mcpaudit.DirectionServer || r.MethodName != "tools/call" || r.ToolName != "ok_tool" || r.Outcome != mcpaudit.OutcomeSuccess {
		t.Fatalf("record = %+v, want direction=server method=tools/call tool=ok_tool outcome=success", r)
	}
	if r.CallerIdentity != "mill-test-client/v9" {
		t.Errorf("CallerIdentity = %q, want the connecting client's initialize name/version", r.CallerIdentity)
	}
}

func TestServerMiddleware_RecordsToolError(t *testing.T) {
	audit := newTestService(t)
	server := buildTestServer(audit)
	ctx := t.Context()
	session := connectPlainClient(t, ctx, server)

	if _, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "failing_tool"}); err != nil {
		t.Fatalf("CallTool: %v", err)
	}

	records, _, err := audit.store.List(mcpauditstore.Filter{}, 10, 0)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(records) != 1 || records[0].Outcome != mcpaudit.OutcomeError || records[0].ErrorText != "boom" {
		t.Fatalf("records = %+v, want one row outcome=error errorText=boom", records)
	}
}

// TestServerMiddleware_ParksThenResolves is the design contract's own
// interim/terminal Parked* state machine: a park-and-poll write's
// initial round trip records OutcomeParked, and ResolveParkedWrite
// (called by mcpsvc once a human decides) mutates that SAME row to a
// terminal value -- proven here without mcpsvc itself, against the raw
// wire text gateWrite produces.
func TestServerMiddleware_ParksThenResolves(t *testing.T) {
	audit := newTestService(t)
	server := buildTestServer(audit)
	ctx := t.Context()
	session := connectPlainClient(t, ctx, server)

	if _, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "parking_tool"}); err != nil {
		t.Fatalf("CallTool: %v", err)
	}

	records, _, err := audit.store.List(mcpauditstore.Filter{}, 10, 0)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(records) != 1 || records[0].Outcome != mcpaudit.OutcomeParked || records[0].ParkedWriteID != "write-abc" {
		t.Fatalf("records = %+v, want one row outcome=parked parkedWriteID=write-abc", records)
	}

	audit.ResolveParkedWrite("write-abc", mcpaudit.OutcomeParkedApproved, "")

	records, _, err = audit.store.List(mcpauditstore.Filter{}, 10, 0)
	if err != nil {
		t.Fatalf("List after resolve: %v", err)
	}
	if len(records) != 1 || records[0].Outcome != mcpaudit.OutcomeParkedApproved {
		t.Fatalf("records after resolve = %+v, want outcome=parked_approved", records)
	}
}

// --- ClientMiddleware (AddSendingMiddleware) ---

func TestClientMiddleware_RecordsSuccessfulToolCall(t *testing.T) {
	audit := newTestService(t)
	server := buildTestServer(audit)
	ctx := mcpaudit.WithCallerIdentity(t.Context(), "workflow-step-42")
	session := connectPlainClient(t, ctx, server, audit.ClientMiddleware())

	if _, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "ok_tool", Arguments: map[string]any{"a": 1}}); err != nil {
		t.Fatalf("CallTool: %v", err)
	}

	var clientRows []mcpaudit.Record
	records, _, err := audit.store.List(mcpauditstore.Filter{}, 10, 0)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	for _, r := range records {
		if r.Direction == mcpaudit.DirectionClient {
			clientRows = append(clientRows, r)
		}
	}
	if len(clientRows) != 1 {
		t.Fatalf("client-direction rows = %d, want 1 (got %+v)", len(clientRows), records)
	}
	r := clientRows[0]
	if r.MethodName != "tools/call" || r.ToolName != "ok_tool" || r.Outcome != mcpaudit.OutcomeSuccess {
		t.Fatalf("record = %+v, want method=tools/call tool=ok_tool outcome=success", r)
	}
	if r.CallerIdentity != "workflow-step-42" {
		t.Errorf("CallerIdentity = %q, want the ctx-carried caller identity", r.CallerIdentity)
	}
	if r.ArgBytes == 0 {
		t.Errorf("ArgBytes = 0, want a positive byte count for a non-empty arguments object")
	}
}

func TestClientMiddleware_RecordsToolError(t *testing.T) {
	audit := newTestService(t)
	server := buildTestServer(audit)
	ctx := mcpaudit.WithCallerIdentity(t.Context(), "workflow-step-99")
	session := connectPlainClient(t, ctx, server, audit.ClientMiddleware())

	if _, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "failing_tool"}); err != nil {
		t.Fatalf("CallTool: %v", err)
	}

	records, _, err := audit.store.List(mcpauditstore.Filter{Direction: mcpaudit.DirectionClient}, 10, 0)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(records) != 1 || records[0].Outcome != mcpaudit.OutcomeError || records[0].ErrorText != "boom" {
		t.Fatalf("records = %+v, want one row outcome=error errorText=boom", records)
	}
}

func TestListMCPCalls_DefaultsAndCapsLimit(t *testing.T) {
	audit := newTestService(t)
	server := buildTestServer(audit)
	ctx := t.Context()
	session := connectPlainClient(t, ctx, server)
	if _, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "ok_tool"}); err != nil {
		t.Fatalf("CallTool: %v", err)
	}

	resp, err := audit.ListMCPCalls(ListMCPCallsRequest{})
	if err != nil {
		t.Fatalf("ListMCPCalls: %v", err)
	}
	if resp.Total != 1 || len(resp.Records) != 1 {
		t.Fatalf("resp = %+v, want total=1 len=1", resp)
	}
	if resp.Records[0].Direction != "server" || resp.Records[0].ToolName != "ok_tool" {
		t.Fatalf("record = %+v, want direction=server tool=ok_tool", resp.Records[0])
	}

	resp, err = audit.ListMCPCalls(ListMCPCallsRequest{Limit: maxLimit + 100})
	if err != nil {
		t.Fatalf("ListMCPCalls with an over-cap limit: %v", err)
	}
	if len(resp.Records) > maxLimit {
		t.Fatalf("len(records) = %d, want capped at maxLimit (%d)", len(resp.Records), maxLimit)
	}
}
