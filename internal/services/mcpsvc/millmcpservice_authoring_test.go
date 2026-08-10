package mcpsvc

import (
	"context"
	"encoding/json"
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

// The full LLM-authoring loop (docs/adr/0025) against a real MCP client
// over real HTTP and a real DBOS runtime: introspect the node-type
// catalog, validate a bad-then-good definition without saving, update a
// workflow's draft (auto-snapshot first), run it, and inspect the run
// -- the author-run-inspect-fix loop end to end.
func TestMCPAuthoring_FullLoop(t *testing.T) {
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

	m := NewMillMCPService("0.0.0-test", comp, cfg, store)
	m.SetExecutionService(exec)
	const addr = "127.0.0.1:18093"
	if err := m.Start(addr); err != nil {
		t.Fatalf("Start: %v", err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = m.Shutdown(ctx)
	})

	client := mcp.NewClient(&mcp.Implementation{Name: "authoring-test", Version: "0.0.0"}, nil)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: "http://" + addr}, nil)
	if err != nil {
		t.Fatalf("Connect: %v", err)
	}
	t.Cleanup(func() { _ = session.Close() })

	call := func(name string, args map[string]any) *mcp.CallToolResult {
		t.Helper()
		res, err := session.CallTool(ctx, &mcp.CallToolParams{Name: name, Arguments: args})
		if err != nil {
			t.Fatalf("CallTool(%s): %v", name, err)
		}
		return res
	}
	text := func(res *mcp.CallToolResult) string {
		t.Helper()
		if len(res.Content) == 0 {
			return ""
		}
		return res.Content[0].(*mcp.TextContent).Text
	}

	// Introspection: the catalog names real node types, ungated.
	catalog := text(call("list_node_types", nil))
	if !strings.Contains(catalog, "process-inject-text") || !strings.Contains(catalog, "Effect") {
		t.Fatalf("list_node_types missing expected content:\n%.300s", catalog)
	}

	// Validation: a bad graph is named, nothing saved; a good one passes.
	bad := `{"label":"x","nodes":[{"id":"a","nodeTypeId":"no-such-type"}],"edges":[]}`
	if v := text(call("validate_workflow", map[string]any{"json": bad})); !strings.HasPrefix(v, "invalid:") {
		t.Fatalf("bad graph validated as %q", v)
	}
	good := `{"label":"MCP authored","nodes":[
		{"ID":"t1","NodeTypeID":"trigger-manual"},
		{"ID":"n1","NodeTypeID":"process-inject-text","Config":{"text":"[authored-v1]","placement":"append"}}],
		"edges":[{"ID":"e1","Source":"t1","Target":"n1"}]}`
	if v := text(call("validate_workflow", map[string]any{"json": good})); v != "valid" {
		t.Fatalf("good graph validated as %q", v)
	}

	// Mutation is refused while the write gate is off (fail-safe default).
	seedID := comp.Workflows()[0].ID
	res := call("update_workflow", map[string]any{"id": seedID, "json": good})
	if !res.IsError {
		t.Fatal("update_workflow must be rejected with the write gate off")
	}

	// Enable writes, relax per-write approval (its own flow has a
	// dedicated test) -- the mutation tier now works: create, update
	// with auto-snapshot, run, inspect.
	if err := store.Set(MCPWriteEnabledKey, "true"); err != nil {
		t.Fatal(err)
	}
	if err := store.Set(MCPWriteApprovalKey, "false"); err != nil {
		t.Fatal(err)
	}

	imported := call("import_workflow", map[string]any{"json": good})
	if imported.IsError {
		t.Fatalf("import_workflow: %+v", imported.Content)
	}
	var importedOut struct {
		ID string `json:"id"`
	}
	// Structured content is the typed result; fall back to text.
	raw := text(imported)
	if err := json.Unmarshal([]byte(raw), &importedOut); err != nil || importedOut.ID == "" {
		for _, wf := range comp.Workflows() {
			if wf.Label == "MCP authored" {
				importedOut.ID = wf.ID
			}
		}
	}
	if importedOut.ID == "" {
		t.Fatal("imported workflow not found")
	}

	updated := strings.Replace(good, "[authored-v1]", "[authored-v2]", 1)
	upRes := call("update_workflow", map[string]any{"id": importedOut.ID, "json": updated})
	if upRes.IsError {
		t.Fatalf("update_workflow: %+v", upRes.Content)
	}
	var target composition.Workflow
	for _, wf := range comp.Workflows() {
		if wf.ID == importedOut.ID {
			target = wf
		}
	}
	if len(target.Versions) != 1 {
		t.Fatalf("auto-snapshot missing: versions = %d, want 1 (the pre-update draft)", len(target.Versions))
	}

	// Run it (test kind, pure/local steps only -- completes synchronously)
	// and inspect via get_run.
	runRes := call("run_workflow", map[string]any{"id": importedOut.ID})
	if runRes.IsError {
		t.Fatalf("run_workflow: %+v", runRes.Content)
	}
	var summary struct {
		RunID  string `json:"runID"`
		Status string `json:"status"`
		Output string `json:"output"`
	}
	if err := json.Unmarshal([]byte(text(runRes)), &summary); err != nil {
		t.Fatalf("run_workflow result not JSON: %v\n%s", err, text(runRes))
	}
	if summary.Status != "SUCCESS" || !strings.Contains(summary.Output, "[authored-v2]") {
		t.Fatalf("run = %+v, want SUCCESS with the v2 marker (proves the update, not the original, executed)", summary)
	}
	detail := text(call("get_run", map[string]any{"runId": summary.RunID}))
	if !strings.Contains(detail, "[authored-v2]") {
		t.Fatalf("get_run missing step output:\n%.300s", detail)
	}

	// Cleanup path is also protocol: delete via the tool.
	if res := call("delete_workflow", map[string]any{"id": importedOut.ID}); res.IsError {
		t.Fatalf("delete_workflow: %+v", res.Content)
	}
}
