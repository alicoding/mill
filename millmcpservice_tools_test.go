package main

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Proves the MCP export/import tool set end to end against a real MCP
// client over real HTTP (same harness as TestMillMCPService_RealClientRoundTrip):
// export works ungated, import is rejected while the default-off gate
// is off, and succeeds -- minting a new ID -- once the gate a human
// controls from Settings is on (ADR-0017's Update).
func TestMillMCPService_Tools_ImportGatedExportOpen(t *testing.T) {
	store := newFakeStore()
	comp := NewCompositionService(store)
	cfg := NewConfigureService(store, comp, testCredentialStore{})

	svc := NewMillMCPService(comp, cfg, store)
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
		[]composition.Node{{NodeTypeID: "capture-clipboard-html"}}, nil)
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
	if got := len(comp.Workflows()); got != 3 { // 2 built-ins + the one created above
		t.Fatalf("workflow count changed to %d despite the gate -- nothing may be written while off", got)
	}

	// Flip the gate the way SettingsService's toggle does, then import.
	if err := store.Set(mcpWriteEnabledKey, "true"); err != nil {
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
	if got := len(comp.Workflows()); got != 4 {
		t.Errorf("workflow count = %d after import, want 4", got)
	}
}
