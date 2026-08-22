package mcpsvc

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/configuresvc"
	"github.com/alicoding/mill/internal/services/executionsvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Goal 0021 gap 1: run_workflow (and run_workflow_stepped's schema)
// accept a `payload` argument substituting what the workflow's trigger
// would have delivered -- without it a trigger-fed workflow (the whole
// ADR-0030 capture floor) is untestable over MCP, the same dead-end
// the UI's Run dialog got its Initial-payload field for. Real MCP
// client over real HTTP, same harness shape as TestMCPAuthoring_FullLoop.
func TestMCPRunWorkflow_PayloadFlowsIntoCaptureFile(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	cfg := configuresvc.NewConfigureService(store, comp, servicetest.FakeCredentialStore{})
	guard := guardrailsvc.NewGuardrailService(store, comp)
	dbPath := filepath.Join(t.TempDir(), "exec.db")
	exec, err := executionsvc.NewExecutionService("sqlite:"+dbPath, comp, guard)
	if err != nil {
		t.Fatalf("NewExecutionService: %v", err)
	}
	t.Cleanup(func() { _ = exec.Shutdown(2 * time.Second) })

	wf, err := comp.CreateWorkflow("payload over MCP", "",
		[]composition.Node{
			{ID: "t", NodeTypeID: "trigger-manual", Kind: composition.KindTrigger},
			{ID: "c", NodeTypeID: "capture-file", Kind: composition.KindCapture,
				Config: map[string]string{"source": "payload"}},
		},
		[]composition.Edge{{ID: "e", Source: "t", Target: "c"}})
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}

	path := filepath.Join(t.TempDir(), "page.html")
	if err := os.WriteFile(path, []byte("<main>payload over MCP works</main>"), 0o600); err != nil {
		t.Fatal(err)
	}

	m := NewMillMCPService("0.0.0-test", comp, cfg, store, nil)
	m.SetExecutionService(exec)
	// run_workflow requires the writes toggle (millmcpservice_tools.go's
	// requireWriteEnabled) -- set the store key directly, same as the
	// other mcpsvc tests do.
	if err := store.Set(MCPWriteEnabledKey, "true"); err != nil {
		t.Fatalf("store.Set: %v", err)
	}
	const addr = "127.0.0.1:18094"
	if err := m.Start(addr); err != nil {
		t.Fatalf("Start: %v", err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = m.Shutdown(ctx)
	})

	client := mcp.NewClient(&mcp.Implementation{Name: "payload-test", Version: "0.0.0"}, nil)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: "http://" + addr}, nil)
	if err != nil {
		t.Fatalf("Connect: %v", err)
	}
	t.Cleanup(func() { _ = session.Close() })

	res, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "run_workflow", Arguments: map[string]any{
		"id": wf.ID, "payload": path,
	}})
	if err != nil {
		t.Fatalf("CallTool(run_workflow): %v", err)
	}
	if len(res.Content) == 0 {
		t.Fatal("empty tool result")
	}
	raw := res.Content[0].(*mcp.TextContent).Text
	var summary struct {
		Status string `json:"status"`
		Output string `json:"output"`
		Error  string `json:"error"`
	}
	if err := json.Unmarshal([]byte(raw), &summary); err != nil {
		t.Fatalf("summary not JSON: %v\n%s", err, raw)
	}
	if summary.Error != "" {
		t.Fatalf("run failed: %s", summary.Error)
	}
	if !strings.Contains(summary.Output, "payload over MCP works") {
		t.Fatalf("output %q does not contain the file's content -- payload did not flow", summary.Output)
	}
}
