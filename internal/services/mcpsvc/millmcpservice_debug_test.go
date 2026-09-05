package mcpsvc

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/adapters/credential"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/configuresvc"
	"github.com/alicoding/mill/internal/services/executionsvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// The MCP debug tools (docs/adr/0031 §6) end to end against a real MCP
// client over real HTTP and a real DBOS runtime -- mirrors
// TestMCPAuthoring_FullLoop's own harness shape. Drives a full stepped
// debug session (run_workflow_stepped -> step_run -> step_run ->
// resume_run) on the seeded "Route an expense by amount" workflow,
// and separately proves the hard-reject boundary: these tools must
// refuse to touch a POLICY park (the seeded "Example: Approval-gated
// HTTP call" workflow's ordinary external-effect ask), never just the
// happy path.
func TestMCPDebugTools_SteppedSessionFullLoop(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	cfg := configuresvc.NewConfigureService(store, comp, credential.New())
	guard := guardrailsvc.NewGuardrailService(store, comp)
	dbPath := filepath.Join(t.TempDir(), "exec.db")
	exec, err := executionsvc.NewExecutionService("sqlite:"+dbPath, comp, guard)
	if err != nil {
		t.Fatalf("NewExecutionService: %v", err)
	}
	t.Cleanup(func() { _ = exec.Shutdown(2 * time.Second) })

	m := NewMillMCPService("0.0.0-test", comp, cfg, store, nil)
	m.SetExecutionService(exec)
	const addr = "127.0.0.1:18094"
	if err := m.Start(addr); err != nil {
		t.Fatalf("Start: %v", err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = m.Shutdown(ctx)
	})

	client := mcp.NewClient(&mcp.Implementation{Name: "debug-test", Version: "0.0.0"}, nil)
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

	// Refused while the write gate is off (fail-safe default) -- same
	// discipline TestMCPAuthoring_FullLoop already proves for the
	// mutation tier, checked here for the debug tier too.
	var branchID string
	for _, wf := range comp.Workflows() {
		if wf.Label == "Route an expense by amount" {
			branchID = wf.ID
		}
	}
	if branchID == "" {
		t.Fatal("seeded workflow not found")
	}
	if res := call("run_workflow_stepped", map[string]any{"id": branchID}); !res.IsError {
		t.Fatal("run_workflow_stepped must be rejected with the write gate off")
	}

	if err := store.Set("mcp-write-tools-enabled", "true"); err != nil {
		t.Fatal(err)
	}

	// --- The hard-reject boundary, checked FIRST: a policy park is not
	//     touchable by any debug tool. ---
	var guardedID string
	for _, wf := range comp.Workflows() {
		if wf.Label == "Post an update to the client portal" {
			guardedID = wf.ID
		}
	}
	if guardedID == "" {
		t.Fatal("seeded guarded workflow not found")
	}
	runRes := call("run_workflow", map[string]any{"id": guardedID})
	if runRes.IsError {
		t.Fatalf("run_workflow (guarded seed): %+v", runRes.Content)
	}
	var guardedSummary struct {
		RunID string `json:"runID"`
	}
	if err := json.Unmarshal([]byte(text(runRes)), &guardedSummary); err != nil || guardedSummary.RunID == "" {
		t.Fatalf("run_workflow result not decodable: %v\n%s", err, text(runRes))
	}
	// The policy ask parks asynchronously -- poll get_run for it.
	deadline := time.Now().Add(10 * time.Second)
	var sawPolicyPending bool
	for time.Now().Before(deadline) {
		var out runDetailPending
		if err := json.Unmarshal([]byte(text(call("get_run", map[string]any{"runId": guardedSummary.RunID}))), &out); err == nil {
			if out.Pending != nil && out.Pending.Source != "debug" {
				sawPolicyPending = true
				break
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	if !sawPolicyPending {
		t.Fatal("guarded seed never showed a policy pending (source != debug) via get_run")
	}
	if res := call("step_run", map[string]any{"runId": guardedSummary.RunID}); !res.IsError {
		t.Fatal("step_run must reject a policy park, not act on it")
	} else if msg := text(res); !strings.Contains(msg, "policy") {
		t.Fatalf("step_run rejection message = %q, want it to name the policy/debug distinction", msg)
	}
	// stop_run must ALSO reject it -- not a debug-tool escape hatch --
	// left parked afterward (this test's own DB is torn down with
	// t.TempDir(), no explicit cleanup needed).
	if res := call("stop_run", map[string]any{"runId": guardedSummary.RunID}); !res.IsError {
		t.Fatal("stop_run must ALSO reject the policy park -- it is not a debug tool escape hatch")
	}

	// --- The real stepped session. ---
	steppedRes := call("run_workflow_stepped", map[string]any{"id": branchID, "values": map[string]any{"amount": "150"}})
	if steppedRes.IsError {
		t.Fatalf("run_workflow_stepped: %+v", steppedRes.Content)
	}
	var steppedSummary struct {
		RunID string `json:"runID"`
	}
	if err := json.Unmarshal([]byte(text(steppedRes)), &steppedSummary); err != nil || steppedSummary.RunID == "" {
		t.Fatalf("run_workflow_stepped result not decodable: %v\n%s", err, text(steppedRes))
	}

	firstNodeID := waitForPendingNodeID(t, call, text, steppedSummary.RunID, "")
	if firstNodeID != "example-branch-capture" {
		t.Fatalf("first pending node = %q, want the capture node", firstNodeID)
	}

	// step_run advances exactly one node -- the run should still be
	// parked afterward (decision-outcome next), not finished.
	if res := call("step_run", map[string]any{"runId": steppedSummary.RunID}); res.IsError {
		t.Fatalf("step_run: %+v", res.Content)
	}
	secondNodeID := waitForPendingNodeID(t, call, text, steppedSummary.RunID, firstNodeID)
	if secondNodeID == firstNodeID || secondNodeID == "" {
		t.Fatalf("step_run did not advance to a new parked node (got %q)", secondNodeID)
	}

	// resume_run finishes the run through to completion.
	if res := call("resume_run", map[string]any{"runId": steppedSummary.RunID}); res.IsError {
		t.Fatalf("resume_run: %+v", res.Content)
	}
	finalDeadline := time.Now().Add(10 * time.Second)
	var finalStatus struct {
		Status string `json:"status"`
		Output string `json:"output"`
	}
	for time.Now().Before(finalDeadline) {
		raw := text(call("get_run", map[string]any{"runId": steppedSummary.RunID}))
		if err := json.Unmarshal([]byte(raw), &finalStatus); err == nil && finalStatus.Status == "SUCCESS" {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	if finalStatus.Status != "SUCCESS" {
		t.Fatalf("stepped run never reached SUCCESS via resume_run, last status = %+v", finalStatus)
	}
	if !strings.Contains(finalStatus.Output, "approve") {
		t.Fatalf("stepped run output missing the expected 'approve' category (amount 150 > 100): %q", finalStatus.Output)
	}
}

// runDetailPending is a narrow decode target for get_run's own JSON
// wire shape -- just enough to read the Pending.Source field this test
// checks, not the full RunDetail struct (an unnecessary cross-package
// dependency for a test that only cares about one field).
type runDetailPending struct {
	Pending *struct {
		Source string `json:"source"`
	} `json:"pending"`
}

// waitForPendingNodeID polls get_run until it reports a pending node
// different from excludeNodeID, returning that node's ID (or "" on
// timeout).
func waitForPendingNodeID(t *testing.T, call func(string, map[string]any) *mcp.CallToolResult, text func(*mcp.CallToolResult) string, runID, excludeNodeID string) string {
	t.Helper()
	var out struct {
		Pending *struct {
			NodeID string `json:"nodeID"`
		} `json:"pending"`
	}
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		raw := text(call("get_run", map[string]any{"runId": runID}))
		if err := json.Unmarshal([]byte(raw), &out); err == nil && out.Pending != nil && out.Pending.NodeID != excludeNodeID {
			return out.Pending.NodeID
		}
		time.Sleep(100 * time.Millisecond)
	}
	return ""
}
