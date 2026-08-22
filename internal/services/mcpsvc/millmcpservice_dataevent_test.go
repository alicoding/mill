package mcpsvc

import (
	"context"
	"encoding/json"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/typedfield"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/configuresvc"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/executionsvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// captureEmits installs dataevent.TestHook, mutex-guarded: every tool
// call in this file runs inside the MCP server's own HTTP-handler
// goroutine (a real StreamableClientTransport round trip, same harness
// millmcpservice_authoring_test.go/millmcpservice_debug_test.go already
// use), a different goroutine from the test's own -- an unsynchronized
// capture would fail -race, same reasoning executionsvc's own
// dataevent test file documents for its DBOS-goroutine completion
// emit. Returns a snapshot func rather than the live slice so a caller
// can reset by calling captureEmits(t) again between tool calls without
// racing a still-in-flight append.
func captureEmits(t *testing.T) func() []dataevent.Changed {
	t.Helper()
	var mu sync.Mutex
	var got []dataevent.Changed
	dataevent.TestHook = func(entity, id string) {
		mu.Lock()
		got = append(got, dataevent.Changed{Entity: entity, ID: id})
		mu.Unlock()
	}
	t.Cleanup(func() { dataevent.TestHook = nil })
	return func() []dataevent.Changed {
		mu.Lock()
		defer mu.Unlock()
		return append([]dataevent.Changed(nil), got...)
	}
}

func assertEmitted(t *testing.T, got []dataevent.Changed, entity, id string) {
	t.Helper()
	for _, c := range got {
		if c.Entity == entity && c.ID == id {
			return
		}
	}
	t.Errorf("dataevent.Emit(%q, %q) was not observed; got %+v", entity, id, got)
}

// mcpToolCaller is the shared call/text helper shape
// millmcpservice_authoring_test.go and millmcpservice_debug_test.go
// each already duplicate locally -- kept local here too (one file, two
// tiny closures) rather than promoted to a shared package helper, since
// every existing caller of this pattern is itself a _test.go file in
// this same package.
func mcpToolCaller(t *testing.T, ctx context.Context, session *mcp.ClientSession) (
	call func(name string, args map[string]any) *mcp.CallToolResult,
	text func(*mcp.CallToolResult) string,
) {
	t.Helper()
	call = func(name string, args map[string]any) *mcp.CallToolResult {
		t.Helper()
		res, err := session.CallTool(ctx, &mcp.CallToolParams{Name: name, Arguments: args})
		if err != nil {
			t.Fatalf("CallTool(%s): %v", name, err)
		}
		return res
	}
	text = func(res *mcp.CallToolResult) string {
		t.Helper()
		if len(res.Content) == 0 {
			return ""
		}
		return res.Content[0].(*mcp.TextContent).Text
	}
	return call, text
}

// Regression: this goal's own box-3 gap -- mcpsvc's own dataevent.Emit
// call sites (run_workflow, the four debug tools, import_list's
// second-mutation emit) had zero dataevent.TestHook coverage anywhere
// in this package. update_workflow/publish_workflow/delete_workflow/
// import_workflow/import_request/import_mcpserver are deliberately NOT
// covered here -- they emit via the underlying compositionsvc/
// configuresvc mutator they delegate to (see each one's own comment in
// millmcpservice_authoring.go/millmcpservice_tools.go), and that emit
// call site is already covered by compositionservice_dataevent_test.go
// / configureservice_dataevent_test.go.
func TestMCPTools_RunWorkflow_EmitsRunDataEvent(t *testing.T) {
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

	wf, err := comp.CreateWorkflow("MCP emit-run target", "",
		[]composition.Node{
			{ID: "t", NodeTypeID: "trigger-manual"},
			{ID: "n", NodeTypeID: "process-inject-text", Config: map[string]string{"text": "x", "placement": "append"}},
		},
		[]composition.Edge{{ID: "e1", Source: "t", Target: "n"}})
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}

	m := NewMillMCPService("0.0.0-test", comp, cfg, store, nil)
	m.SetExecutionService(exec)
	const addr = "127.0.0.1:18095"
	if err := m.Start(addr); err != nil {
		t.Fatalf("Start: %v", err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = m.Shutdown(ctx)
	})
	if err := store.Set(MCPWriteEnabledKey, "true"); err != nil {
		t.Fatal(err)
	}

	client := mcp.NewClient(&mcp.Implementation{Name: "dataevent-test", Version: "0.0.0"}, nil)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: "http://" + addr}, nil)
	if err != nil {
		t.Fatalf("Connect: %v", err)
	}
	t.Cleanup(func() { _ = session.Close() })
	call, text := mcpToolCaller(t, ctx, session)

	snapshot := captureEmits(t)
	res := call("run_workflow", map[string]any{"id": wf.ID})
	if res.IsError {
		t.Fatalf("run_workflow: %+v", res.Content)
	}
	var summary struct {
		RunID string `json:"runID"`
	}
	if err := json.Unmarshal([]byte(text(res)), &summary); err != nil || summary.RunID == "" {
		t.Fatalf("run_workflow result not decodable: %v\n%s", err, text(res))
	}
	assertEmitted(t, snapshot(), "run", summary.RunID)
}

// Covers all four debug-tool emit call sites (millmcpservice_debug.go):
// run_workflow_stepped and step_run/resume_run against one stepped
// session, stop_run against a second -- a park can only be resolved
// once, so resume_run and stop_run each need their own fresh run.
func TestMCPDebugTools_EmitRunDataEvent(t *testing.T) {
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

	var branchID string
	for _, wf := range comp.Workflows() {
		if wf.Label == "Example: Branch to a decision" {
			branchID = wf.ID
		}
	}
	if branchID == "" {
		t.Fatal("seeded workflow \"Example: Branch to a decision\" not found")
	}

	m := NewMillMCPService("0.0.0-test", comp, cfg, store, nil)
	m.SetExecutionService(exec)
	const addr = "127.0.0.1:18096"
	if err := m.Start(addr); err != nil {
		t.Fatalf("Start: %v", err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = m.Shutdown(ctx)
	})
	if err := store.Set(MCPWriteEnabledKey, "true"); err != nil {
		t.Fatal(err)
	}

	client := mcp.NewClient(&mcp.Implementation{Name: "debug-dataevent-test", Version: "0.0.0"}, nil)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: "http://" + addr}, nil)
	if err != nil {
		t.Fatalf("Connect: %v", err)
	}
	t.Cleanup(func() { _ = session.Close() })
	call, text := mcpToolCaller(t, ctx, session)

	decodeRunID := func(res *mcp.CallToolResult) string {
		t.Helper()
		var out struct {
			RunID string `json:"runID"`
		}
		if err := json.Unmarshal([]byte(text(res)), &out); err != nil || out.RunID == "" {
			t.Fatalf("result not decodable to a runID: %v\n%s", err, text(res))
		}
		return out.RunID
	}

	// --- run_workflow_stepped + step_run + resume_run, one session. ---
	snapshot := captureEmits(t)
	steppedRes := call("run_workflow_stepped", map[string]any{"id": branchID, "values": map[string]any{"amount": "150"}})
	if steppedRes.IsError {
		t.Fatalf("run_workflow_stepped: %+v", steppedRes.Content)
	}
	runID := decodeRunID(steppedRes)
	assertEmitted(t, snapshot(), "run", runID)

	firstNodeID := waitForPendingNodeID(t, call, text, runID, "")
	if firstNodeID == "" {
		t.Fatal("run_workflow_stepped never showed a pending node via get_run")
	}

	snapshot = captureEmits(t)
	stepRes := call("step_run", map[string]any{"runId": runID})
	if stepRes.IsError {
		t.Fatalf("step_run: %+v", stepRes.Content)
	}
	assertEmitted(t, snapshot(), "run", runID)

	if secondNodeID := waitForPendingNodeID(t, call, text, runID, firstNodeID); secondNodeID == "" {
		t.Fatal("step_run did not advance to a new parked node")
	}

	snapshot = captureEmits(t)
	resumeRes := call("resume_run", map[string]any{"runId": runID})
	if resumeRes.IsError {
		t.Fatalf("resume_run: %+v", resumeRes.Content)
	}
	assertEmitted(t, snapshot(), "run", runID)

	// --- stop_run, a fresh session (a park resolves exactly once). ---
	snapshot = captureEmits(t)
	steppedRes2 := call("run_workflow_stepped", map[string]any{"id": branchID, "values": map[string]any{"amount": "150"}})
	if steppedRes2.IsError {
		t.Fatalf("run_workflow_stepped (2nd session): %+v", steppedRes2.Content)
	}
	runID2 := decodeRunID(steppedRes2)
	assertEmitted(t, snapshot(), "run", runID2)
	if waitForPendingNodeID(t, call, text, runID2, "") == "" {
		t.Fatal("2nd run_workflow_stepped never showed a pending node via get_run")
	}

	snapshot = captureEmits(t)
	stopRes := call("stop_run", map[string]any{"runId": runID2})
	if stopRes.IsError {
		t.Fatalf("stop_run: %+v", stopRes.Content)
	}
	assertEmitted(t, snapshot(), "run", runID2)
}

// import_list is the one import_* tool with its own manual
// dataevent.Emit call (millmcpservice_tools.go's own comment explains
// why: ImportList's row-attach step is a SECOND mutation CreateList's
// internal emit can't see) -- the other three import_* tools delegate
// entirely to an already-covered compositionsvc/configuresvc emit.
func TestMCPTools_ImportList_EmitsListDataEvent(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	cfg := configuresvc.NewConfigureService(store, comp, servicetest.FakeCredentialStore{})

	created, err := cfg.CreateList("Emit-source list", "", []typedfield.Field{
		{Key: "a", Label: "A", Type: typedfield.TypeText},
	})
	if err != nil {
		t.Fatalf("CreateList: %v", err)
	}
	if _, err := cfg.AddListRow(created.ID, map[string]string{"a": "1"}); err != nil {
		t.Fatalf("AddListRow: %v", err)
	}
	exported, err := cfg.ExportList(created.ID)
	if err != nil {
		t.Fatalf("ExportList: %v", err)
	}

	m := NewMillMCPService("0.0.0-test", comp, cfg, store, nil)
	const addr = "127.0.0.1:18097"
	if err := m.Start(addr); err != nil {
		t.Fatalf("Start: %v", err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = m.Shutdown(ctx)
	})
	if err := store.Set(MCPWriteApprovalKey, "false"); err != nil {
		t.Fatal(err)
	}
	if err := store.Set(MCPWriteEnabledKey, "true"); err != nil {
		t.Fatal(err)
	}

	client := mcp.NewClient(&mcp.Implementation{Name: "import-list-dataevent-test", Version: "0.0.0"}, nil)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: "http://" + addr}, nil)
	if err != nil {
		t.Fatalf("Connect: %v", err)
	}
	t.Cleanup(func() { _ = session.Close() })
	call, text := mcpToolCaller(t, ctx, session)

	snapshot := captureEmits(t)
	res := call("import_list", map[string]any{"json": exported})
	if res.IsError {
		t.Fatalf("import_list: %+v", res.Content)
	}
	var imported importToolResult
	if err := json.Unmarshal([]byte(text(res)), &imported); err != nil || imported.ID == "" {
		t.Fatalf("import_list result not decodable: %v\n%s", err, text(res))
	}
	assertEmitted(t, snapshot(), "list", imported.ID)
}
