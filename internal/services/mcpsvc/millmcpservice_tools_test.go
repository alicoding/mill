package mcpsvc

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/configuresvc"
	"github.com/alicoding/mill/internal/services/servicetest"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Proves the MCP export/import tool set end to end against a real MCP
// client over real HTTP (same harness as TestMillMCPService_RealClientRoundTrip):
// export works ungated, import is rejected while the default-off gate
// is off, and succeeds -- minting a new ID -- once the gate a human
// controls from Settings is on (ADR-0017's Update).
func TestMillMCPService_Tools_ImportGatedExportOpen(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	cfg := configuresvc.NewConfigureService(store, comp, servicetest.FakeCredentialStore{})

	svc := NewMillMCPService("0.0.0-test", comp, cfg, store)
	const addr = "127.0.0.1:18091"
	if err := svc.Start(addr); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = svc.Shutdown(ctx)
	}()

	wf, err := comp.CreateWorkflow("MCP tools workflow", "import/export tool test",
		[]composition.Node{{ID: "t", NodeTypeID: "trigger-manual"}, {ID: "c", NodeTypeID: "capture-clipboard-html"}},
		[]composition.Edge{{ID: "e1", Source: "t", Target: "c"}})
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}

	client := mcp.NewClient(&mcp.Implementation{Name: "mill-mcp-tools-test", Version: "0.0.0"}, nil)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: "http://" + addr}, nil)
	if err != nil {
		t.Fatalf("client.Connect: %v", err)
	}
	defer func() { _ = session.Close() }()

	tools, err := session.ListTools(ctx, nil)
	if err != nil {
		t.Fatalf("ListTools: %v", err)
	}
	names := map[string]bool{}
	for _, tool := range tools.Tools {
		names[tool.Name] = true
	}
	for _, want := range []string{"export_workflow", "export_request", "export_list", "export_mcpserver",
		"import_workflow", "import_request", "import_list", "import_mcpserver"} {
		if !names[want] {
			t.Errorf("ListTools missing %q, got %v", want, names)
		}
	}

	// Export is read-only and works with the gate off.
	res, err := session.CallTool(ctx, &mcp.CallToolParams{
		Name: "export_workflow", Arguments: map[string]any{"id": wf.ID},
	})
	if err != nil {
		t.Fatalf("CallTool(export_workflow): %v", err)
	}
	if res.IsError {
		t.Fatalf("export_workflow errored: %+v", res.Content)
	}
	exported := res.Content[0].(*mcp.TextContent).Text
	if !strings.Contains(exported, "MCP tools workflow") {
		t.Fatalf("export_workflow output doesn't contain the workflow label:\n%s", exported)
	}

	// Import is rejected while the gate is off (the default).
	countBeforeGateOffAttempt := len(comp.Workflows())
	res, err = session.CallTool(ctx, &mcp.CallToolParams{
		Name: "import_workflow", Arguments: map[string]any{"json": exported},
	})
	if err != nil {
		t.Fatalf("CallTool(import_workflow, gate off): %v", err)
	}
	if !res.IsError {
		t.Fatal("import_workflow succeeded with the write gate off -- must be rejected by default")
	}
	if msg := res.Content[0].(*mcp.TextContent).Text; !strings.Contains(msg, "Settings") {
		t.Errorf("gate rejection should point the agent at Mill's Settings, got: %s", msg)
	}
	// Nothing may have been written while the gate was off.
	countBefore := len(comp.Workflows())
	if countBefore != countBeforeGateOffAttempt {
		t.Fatalf("workflow count changed to %d despite the gate -- nothing may be written while off", countBefore)
	}

	// Flip the gate the way SettingsService's toggle does, then import.
	// Relax the per-write approval for this unattended test -- the
	// approval flow itself has its own dedicated test below.
	if err := store.Set(MCPWriteApprovalKey, "false"); err != nil {
		t.Fatalf("set approval key: %v", err)
	}
	if err := store.Set(MCPWriteEnabledKey, "true"); err != nil {
		t.Fatalf("store.Set: %v", err)
	}
	res, err = session.CallTool(ctx, &mcp.CallToolParams{
		Name: "import_workflow", Arguments: map[string]any{"json": exported},
	})
	if err != nil {
		t.Fatalf("CallTool(import_workflow, gate on): %v", err)
	}
	if res.IsError {
		t.Fatalf("import_workflow errored with the gate on: %+v", res.Content)
	}
	var imported struct {
		ID    string `json:"id"`
		Label string `json:"label"`
	}
	if err := json.Unmarshal([]byte(res.Content[0].(*mcp.TextContent).Text), &imported); err != nil {
		t.Fatalf("import_workflow result is not the typed {id,label} JSON: %v", err)
	}
	if imported.ID == wf.ID {
		t.Error("import reused the original workflow ID -- must always mint a new one")
	}
	if imported.Label != "MCP tools workflow" {
		t.Errorf("imported label = %q, want the exported label", imported.Label)
	}
	if got := len(comp.Workflows()); got != countBefore+1 {
		t.Errorf("workflow count = %d after import, want %d", got, countBefore+1)
	}
}

// Per-write approval (docs/adr/0017's second half): with writes enabled
// and approval required (the default), an import parks until a human
// resolves it -- denied writes write nothing, approved ones proceed.
func TestMCPWriteTools_PerWriteApproval(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	cfg := configuresvc.NewConfigureService(store, comp, servicetest.FakeCredentialStore{})

	m := NewMillMCPService("0.0.0-test", comp, cfg, store)
	const addr = "127.0.0.1:18092"
	if err := m.Start(addr); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = m.Shutdown(ctx)
	}()

	wf, err := comp.CreateWorkflow("Approval test workflow", "",
		[]composition.Node{{ID: "t", NodeTypeID: "trigger-manual"}, {ID: "c", NodeTypeID: "capture-clipboard-html"}},
		[]composition.Edge{{ID: "e1", Source: "t", Target: "c"}})
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}

	client := mcp.NewClient(&mcp.Implementation{Name: "mill-mcp-approval-test", Version: "0.0.0"}, nil)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: "http://" + addr}, nil)
	if err != nil {
		t.Fatalf("client.Connect: %v", err)
	}
	defer func() { _ = session.Close() }()

	if err := store.Set(MCPWriteEnabledKey, "true"); err != nil {
		t.Fatalf("set write key: %v", err)
	}
	// approval key left unset: required is the DEFAULT -- enabling
	// writes must not silently mean unattended writes.

	res, err := session.CallTool(ctx, &mcp.CallToolParams{
		Name: "export_workflow", Arguments: map[string]any{"id": wf.ID},
	})
	if err != nil || res.IsError {
		t.Fatalf("export_workflow: err=%v res=%+v", err, res)
	}
	exported := res.Content[0].(*mcp.TextContent).Text
	before := len(comp.Workflows())

	type callOut struct {
		res *mcp.CallToolResult
		err error
	}
	done := make(chan callOut, 1)
	call := func() {
		res, err := session.CallTool(ctx, &mcp.CallToolParams{
			Name: "import_workflow", Arguments: map[string]any{"json": exported},
		})
		done <- callOut{res, err}
	}
	awaitPending := func() MCPWriteRequest {
		t.Helper()
		deadline := time.Now().Add(5 * time.Second)
		for time.Now().Before(deadline) {
			if pending := m.PendingMCPWrites(); len(pending) == 1 {
				return pending[0]
			}
			time.Sleep(20 * time.Millisecond)
		}
		t.Fatal("import never parked as a pending MCP write")
		return MCPWriteRequest{}
	}

	// Deny path: the tool returns an error result and nothing was written.
	go call()
	if err := m.ResolveMCPWrite(awaitPending().ID, false); err != nil {
		t.Fatalf("ResolveMCPWrite(deny): %v", err)
	}
	out := <-done
	if out.err != nil {
		t.Fatalf("CallTool transport error: %v", out.err)
	}
	if !out.res.IsError {
		t.Fatal("denied import must return an error result")
	}
	if len(comp.Workflows()) != before {
		t.Fatal("denied import must write nothing")
	}

	// Approve path: same call, resolved true this time.
	go call()
	if err := m.ResolveMCPWrite(awaitPending().ID, true); err != nil {
		t.Fatalf("ResolveMCPWrite(approve): %v", err)
	}
	out = <-done
	if out.err != nil || out.res.IsError {
		t.Fatalf("approved import failed: err=%v res=%+v", out.err, out.res)
	}
	if len(comp.Workflows()) != before+1 {
		t.Fatal("approved import must have created the workflow")
	}
}
