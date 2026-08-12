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

// decodeValidation parses validate_workflow's own JSON wire shape
// (docs/adr/0028: {"valid": bool, "issues": [...]}, millmcpservice_authoring.go's
// validationResult) out of a tool result's text content.
func decodeValidation(t *testing.T, raw string) validationResult {
	t.Helper()
	var out validationResult
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		t.Fatalf("validate_workflow result not JSON: %v\n%s", err, raw)
	}
	return out
}

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

	// Validation (docs/adr/0028): the FULL issue list comes back, not
	// just the first problem -- a bad graph reports at least one error
	// issue; a good graph is valid (no errors) but the good fixture
	// below is itself a Trigger -> Process CHAIN ending in a leaf, so it
	// carries a real warning issue too, proving both severities surface
	// through this same tool.
	bad := `{"label":"x","nodes":[{"id":"a","nodeTypeId":"no-such-type"}],"edges":[]}`
	badResult := decodeValidation(t, text(call("validate_workflow", map[string]any{"json": bad})))
	if badResult.Valid || len(badResult.Issues) == 0 {
		t.Fatalf("bad graph validated as %+v, want invalid with at least one issue", badResult)
	}
	good := `{"label":"MCP authored","nodes":[
		{"ID":"t1","NodeTypeID":"trigger-manual"},
		{"ID":"n1","NodeTypeID":"process-inject-text","Config":{"text":"[authored-v1]","placement":"append"}}],
		"edges":[{"ID":"e1","Source":"t1","Target":"n1"}]}`
	goodResult := decodeValidation(t, text(call("validate_workflow", map[string]any{"json": good})))
	if !goodResult.Valid {
		t.Fatalf("good graph validated as %+v, want valid (no error-severity issue)", goodResult)
	}
	var sawWarning bool
	for _, issue := range goodResult.Issues {
		if issue.Severity == composition.SeverityWarning {
			sawWarning = true
		}
	}
	if !sawWarning {
		t.Fatalf("good graph (trigger -> process-inject-text, a dangling leaf) should report a Process-leaf warning issue, got %+v", goodResult.Issues)
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

// TestUpdateDiffSummary_MalformedJSON_NeverFabricatesCounts is the
// docs/goals/0025 item 4 repro: a proposed definition that fails to
// parse must not silently render as "nodes N→0, edges N→0" (next
// staying its zero value after a swallowed json.Unmarshal error) --
// that reads to the human approver as "this deletes everything," a
// fabricated claim about a document Mill never actually understood.
func TestUpdateDiffSummary_MalformedJSON_NeverFabricatesCounts(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	cfg := configuresvc.NewConfigureService(store, comp, servicetest.FakeCredentialStore{})
	svc := NewMillMCPService("0.0.0-test", comp, cfg, store)

	wf, err := comp.CreateWorkflow("Diff summary target", "",
		[]composition.Node{{ID: "t", NodeTypeID: "trigger-manual"}, {ID: "c", NodeTypeID: "capture-clipboard-html"}},
		[]composition.Edge{{ID: "e1", Source: "t", Target: "c"}})
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}

	got := svc.updateDiffSummary(wf.ID, "{not valid json")

	if strings.Contains(got, "→0") || strings.Contains(got, "2→") {
		t.Fatalf("updateDiffSummary(malformed JSON) = %q, contains a fabricated node/edge count", got)
	}
	if !strings.Contains(got, "unable to parse proposed definition") {
		t.Errorf("updateDiffSummary(malformed JSON) = %q, want it to say the proposed definition couldn't be parsed", got)
	}
	if !strings.Contains(got, wf.Label) {
		t.Errorf("updateDiffSummary(malformed JSON) = %q, want it to still name the target workflow %q", got, wf.Label)
	}
}

// TestUpdateDiffSummary_WellFormedJSON_StillReportsRealCounts guards
// against a fix for the above accidentally breaking the normal path --
// a well-formed proposed definition must still render real node/edge
// counts, not the malformed-input message.
func TestUpdateDiffSummary_WellFormedJSON_StillReportsRealCounts(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	cfg := configuresvc.NewConfigureService(store, comp, servicetest.FakeCredentialStore{})
	svc := NewMillMCPService("0.0.0-test", comp, cfg, store)

	wf, err := comp.CreateWorkflow("Diff summary target 2", "",
		[]composition.Node{{ID: "t", NodeTypeID: "trigger-manual"}},
		nil)
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}

	proposed := `{"label":"Diff summary target 2","nodes":[{"id":"t","nodeTypeId":"trigger-manual"},{"id":"c","nodeTypeId":"capture-clipboard-html"}],"edges":[{"id":"e1","source":"t","target":"c"}]}`
	got := svc.updateDiffSummary(wf.ID, proposed)

	if strings.Contains(got, "unable to parse") {
		t.Fatalf("updateDiffSummary(well-formed JSON) = %q, want a real diff, not the parse-failure message", got)
	}
	if !strings.Contains(got, "nodes 1→2") || !strings.Contains(got, "edges 0→1") {
		t.Errorf("updateDiffSummary(well-formed JSON) = %q, want it to report the real 1→2 node / 0→1 edge change", got)
	}
}
