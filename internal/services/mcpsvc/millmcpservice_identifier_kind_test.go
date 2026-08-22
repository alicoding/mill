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

// Goal 0021 Phase 3: the orchestrator's live Phase-2 MCP probe found two
// gaps in an otherwise-working tool surface -- (1) inconsistent
// identifier argument names across tools (run_workflow/update_workflow/
// export_workflow/publish_workflow/delete_workflow all took a bare
// "id" while get_run/list_runs already used the more explicit
// runId/workflowId, pure interop friction for a real client), and (2)
// run_workflow always landing "test" kind with no way to opt out,
// silently excluded from Home's automation metrics by default -- wrong
// for a production agent invoking a real workflow. Both proofs below
// run a real MCP client over real HTTP and a real DBOS runtime, the
// same harness shape every other file in this package already uses
// (TestMCPAuthoring_FullLoop).

func newIdentifierKindHarness(t *testing.T, addr string) (*compositionsvc.CompositionService, *executionsvc.ExecutionService, *mcp.ClientSession) {
	t.Helper()
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

	m := NewMillMCPService("0.0.0-test", comp, cfg, store, nil)
	m.SetExecutionService(exec)
	if err := store.Set(MCPWriteEnabledKey, "true"); err != nil {
		t.Fatalf("store.Set(MCPWriteEnabledKey): %v", err)
	}
	if err := store.Set(MCPWriteApprovalKey, "false"); err != nil {
		t.Fatalf("store.Set(MCPWriteApprovalKey): %v", err)
	}
	if err := m.Start(addr); err != nil {
		t.Fatalf("Start: %v", err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = m.Shutdown(ctx)
	})

	client := mcp.NewClient(&mcp.Implementation{Name: "identifier-kind-test", Version: "0.0.0"}, nil)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: "http://" + addr}, nil)
	if err != nil {
		t.Fatalf("Connect: %v", err)
	}
	t.Cleanup(func() { _ = session.Close() })
	return comp, exec, session
}

func callTool(t *testing.T, session *mcp.ClientSession, name string, args map[string]any) *mcp.CallToolResult {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	res, err := session.CallTool(ctx, &mcp.CallToolParams{Name: name, Arguments: args})
	if err != nil {
		t.Fatalf("CallTool(%s): %v", name, err)
	}
	return res
}

func toolText(t *testing.T, res *mcp.CallToolResult) string {
	t.Helper()
	if res.IsError {
		t.Fatalf("tool call errored: %+v", res.Content)
	}
	if len(res.Content) == 0 {
		return ""
	}
	return res.Content[0].(*mcp.TextContent).Text
}

// TestMCPIdentifierAliases_CanonicalNamesResolveAcrossTheSurface proves
// the goal 0021 Phase 3 gap-1 fix: run_workflow, update_workflow,
// export_workflow, and delete_workflow -- every tool that used to take
// a bare "id" for a workflow -- now also accept the explicit canonical
// "workflowId", exercised end to end with a real MCP client using ONLY
// the canonical name throughout. get_run/list_runs already used their
// own canonical names (runId/workflowId) before this fix; included here
// to prove the full identifier surface is consistent, not just the
// newly-aliased tools.
func TestMCPIdentifierAliases_CanonicalNamesResolveAcrossTheSurface(t *testing.T) {
	comp, _, session := newIdentifierKindHarness(t, "127.0.0.1:18097")

	wf, err := comp.CreateWorkflow("Identifier alias workflow", "",
		[]composition.Node{
			{ID: "t", NodeTypeID: "trigger-manual"},
			{ID: "n", NodeTypeID: "process-inject-text", Config: map[string]string{"text": "[alias-v1]", "placement": "append"}},
		},
		[]composition.Edge{{ID: "e", Source: "t", Target: "n"}})
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}

	// export_workflow via the canonical "workflowId" (previously only "id").
	exported := toolText(t, callTool(t, session, "export_workflow", map[string]any{"workflowId": wf.ID}))
	if !strings.Contains(exported, "Identifier alias workflow") {
		t.Fatalf("export_workflow(workflowId=...) missing the workflow label:\n%.300s", exported)
	}

	// update_workflow via "workflowId".
	updated := strings.Replace(exported, "[alias-v1]", "[alias-v2]", 1)
	upRes := callTool(t, session, "update_workflow", map[string]any{"workflowId": wf.ID, "json": updated})
	if upRes.IsError {
		t.Fatalf("update_workflow(workflowId=...): %+v", upRes.Content)
	}

	// run_workflow via "workflowId" -- also proves the update landed.
	runOut := toolText(t, callTool(t, session, "run_workflow", map[string]any{"workflowId": wf.ID}))
	var summary struct {
		RunID  string `json:"runID"`
		Status string `json:"status"`
		Output string `json:"output"`
	}
	if err := json.Unmarshal([]byte(runOut), &summary); err != nil {
		t.Fatalf("run_workflow result not JSON: %v\n%s", err, runOut)
	}
	if summary.Status != "SUCCESS" || !strings.Contains(summary.Output, "[alias-v2]") {
		t.Fatalf("run = %+v, want SUCCESS with the v2 marker (proves workflowId resolved to the right workflow)", summary)
	}

	// get_run -- already canonical ("runId"), unaffected by this fix;
	// checked here so the whole loop is proven through one consistent
	// vocabulary.
	detail := toolText(t, callTool(t, session, "get_run", map[string]any{"runId": summary.RunID}))
	if !strings.Contains(detail, "[alias-v2]") {
		t.Fatalf("get_run(runId=...) missing step output:\n%.300s", detail)
	}

	// list_runs -- already canonical ("workflowId"), unaffected.
	runsOut := toolText(t, callTool(t, session, "list_runs", map[string]any{"workflowId": wf.ID}))
	if !strings.Contains(runsOut, summary.RunID) {
		t.Fatalf("list_runs(workflowId=...) missing the run just started:\n%.300s", runsOut)
	}

	// delete_workflow via "workflowId" -- cleanup is also protocol.
	if res := callTool(t, session, "delete_workflow", map[string]any{"workflowId": wf.ID}); res.IsError {
		t.Fatalf("delete_workflow(workflowId=...): %+v", res.Content)
	}
}

// TestMCPIdentifierAliases_LegacyIdStillResolves is the backward-
// compatibility half of the gap-1 fix: every existing caller sending
// the ORIGINAL "id" argument (run_workflow's own pre-fix shape, and
// every other MCP-authoring test in this package) must keep working
// unchanged -- goal 0021 Phase 3 explicitly requires this fix stay
// backward compatible, not a breaking rename.
func TestMCPIdentifierAliases_LegacyIdStillResolves(t *testing.T) {
	comp, _, session := newIdentifierKindHarness(t, "127.0.0.1:18098")

	wf, err := comp.CreateWorkflow("Legacy id workflow", "",
		[]composition.Node{{ID: "t", NodeTypeID: "trigger-manual"}, {ID: "n", NodeTypeID: "process-inject-text", Config: map[string]string{"text": "[legacy]", "placement": "append"}}},
		[]composition.Edge{{ID: "e", Source: "t", Target: "n"}})
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}

	exported := toolText(t, callTool(t, session, "export_workflow", map[string]any{"id": wf.ID}))
	if !strings.Contains(exported, "Legacy id workflow") {
		t.Fatalf("export_workflow(id=...) missing the workflow label:\n%.300s", exported)
	}

	runOut := toolText(t, callTool(t, session, "run_workflow", map[string]any{"id": wf.ID}))
	var summary struct {
		Status string `json:"status"`
		Output string `json:"output"`
	}
	if err := json.Unmarshal([]byte(runOut), &summary); err != nil {
		t.Fatalf("run_workflow result not JSON: %v\n%s", err, runOut)
	}
	if summary.Status != "SUCCESS" || !strings.Contains(summary.Output, "[legacy]") {
		t.Fatalf("run_workflow(id=...) = %+v, want a SUCCESS run of the right workflow", summary)
	}

	if res := callTool(t, session, "delete_workflow", map[string]any{"id": wf.ID}); res.IsError {
		t.Fatalf("delete_workflow(id=...): %+v", res.Content)
	}
}

// TestMCPRunWorkflow_TestFlagControlsRunKindAndHomeVisibility proves the
// goal 0021 Phase 3 gap-2 fix: run_workflow's new `test` argument
// controls which RunKind the run lands as, and that kind is what
// decides whether the run counts in Home's default metrics view --
// not merely that a "kind" string changed. Omitting `test` (the
// default) must land RunKindMCP and count in HomeMetrics' Ambient
// automation bucket exactly like a real trigger fire would; test:true
// must land RunKindTest and count as manual instead, matching the UI's
// own Test-run button. Both runs execute the identical draft graph --
// only the tag and its metrics visibility differ. run_workflow_stepped
// has no test argument at all and always lands RunKindTest -- a debug/
// inspection surface, never production automation.
func TestMCPRunWorkflow_TestFlagControlsRunKindAndHomeVisibility(t *testing.T) {
	comp, exec, session := newIdentifierKindHarness(t, "127.0.0.1:18099")

	wf, err := comp.CreateWorkflow("Run kind workflow", "",
		[]composition.Node{{ID: "t", NodeTypeID: "trigger-manual"}, {ID: "n", NodeTypeID: "process-inject-text", Config: map[string]string{"text": "[kind]", "placement": "append"}}},
		[]composition.Edge{{ID: "e", Source: "t", Target: "n"}})
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}

	type runResult struct {
		RunID string               `json:"runID"`
		Kind  executionsvc.RunKind `json:"kind"`
	}

	// Default call (test omitted) -- must land RunKindMCP.
	defaultOut := toolText(t, callTool(t, session, "run_workflow", map[string]any{"id": wf.ID}))
	var defaultSummary runResult
	if err := json.Unmarshal([]byte(defaultOut), &defaultSummary); err != nil {
		t.Fatalf("run_workflow (default) result not JSON: %v\n%s", err, defaultOut)
	}
	if defaultSummary.Kind != executionsvc.RunKindMCP {
		t.Fatalf("run_workflow with test omitted landed kind %q, want %q", defaultSummary.Kind, executionsvc.RunKindMCP)
	}

	// Explicit test:true -- must land RunKindTest.
	testOut := toolText(t, callTool(t, session, "run_workflow", map[string]any{"id": wf.ID, "test": true}))
	var testSummary runResult
	if err := json.Unmarshal([]byte(testOut), &testSummary); err != nil {
		t.Fatalf("run_workflow (test:true) result not JSON: %v\n%s", err, testOut)
	}
	if testSummary.Kind != executionsvc.RunKindTest {
		t.Fatalf("run_workflow with test:true landed kind %q, want %q", testSummary.Kind, executionsvc.RunKindTest)
	}

	// run_workflow_stepped -- always RunKindTest, no test argument
	// exists on its schema at all.
	steppedOut := toolText(t, callTool(t, session, "run_workflow_stepped", map[string]any{"id": wf.ID}))
	var steppedSummary runResult
	if err := json.Unmarshal([]byte(steppedOut), &steppedSummary); err != nil {
		t.Fatalf("run_workflow_stepped result not JSON: %v\n%s", err, steppedOut)
	}
	if steppedSummary.Kind != executionsvc.RunKindTest {
		t.Fatalf("run_workflow_stepped landed kind %q, want %q (always test, debug surface)", steppedSummary.Kind, executionsvc.RunKindTest)
	}
	// Left parked at its first node afterward -- this test's own temp
	// DB (t.TempDir()) is torn down at test end, same as
	// TestMCPDebugTools_SteppedSessionFullLoop's own guarded-park case,
	// no explicit stop_run/cleanup needed.

	// Home's Ambient metric (automation vs. manual, executionservice_home.go)
	// must count the default MCP run as automation and the test:true run
	// as manual -- proving the kind tag actually changes what's counted,
	// not just what's labeled.
	from := time.Now().Add(-1 * time.Hour).Format(time.RFC3339)
	to := time.Now().Add(1 * time.Hour).Format(time.RFC3339)
	metrics, err := exec.HomeMetrics(from, to, false)
	if err != nil {
		t.Fatalf("HomeMetrics: %v", err)
	}
	if metrics.Ambient.TriggeredCount < 1 {
		t.Errorf("HomeMetrics.Ambient.TriggeredCount = %d, want at least 1 (the default MCP run counts as real automation)", metrics.Ambient.TriggeredCount)
	}
	if metrics.Ambient.ManualCount < 1 {
		t.Errorf("HomeMetrics.Ambient.ManualCount = %d, want at least 1 (the test:true run still counts as manual)", metrics.Ambient.ManualCount)
	}

	scoped, err := exec.ListRunsForWorkflow(wf.ID)
	if err != nil {
		t.Fatalf("ListRunsForWorkflow: %v", err)
	}
	var sawMCPRun, sawTestRun bool
	for _, r := range scoped {
		if r.RunID == defaultSummary.RunID && r.Kind == executionsvc.RunKindMCP {
			sawMCPRun = true
		}
		if r.RunID == testSummary.RunID && r.Kind == executionsvc.RunKindTest {
			sawTestRun = true
		}
	}
	if !sawMCPRun || !sawTestRun {
		t.Fatalf("ListRunsForWorkflow durable history should reflect both kinds, got mcp=%v test=%v", sawMCPRun, sawTestRun)
	}
}
