package mcpsvc

// Park-and-poll approval lifecycle tests (docs/adr/0032): the courtesy
// window, expiry, and restart-survival behaviors that
// millmcpservice_tools_test.go's own per-write-approval test doesn't
// cover -- split out once that file approached the 500-line convention
// (CLAUDE.md), along the natural millmcpservice_approval.go seam.

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/configuresvc"
	"github.com/alicoding/mill/internal/services/servicetest"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// errFakeMCPPersist is the injected failure servicetest.FakeStore.SetErr
// returns for the persist-failure tests below (docs/goals/0025 items
// 1/2).
var errFakeMCPPersist = errors.New("fake persist failure")


// mcpApprovalHarness spins up a real MillMCPService + real MCP client
// over real HTTP, with a workflow ready to export/import -- the shared
// setup every park-and-poll test below (docs/adr/0032) needs.
type mcpApprovalHarness struct {
	store   *servicetest.FakeStore
	comp    *compositionsvc.CompositionService
	cfg     *configuresvc.ConfigureService
	svc     *MillMCPService
	session *mcp.ClientSession
	ctx     context.Context

	exported string
	before   int
}

func newMCPApprovalHarness(t *testing.T, addr, workflowLabel string) *mcpApprovalHarness {
	t.Helper()
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	cfg := configuresvc.NewConfigureService(store, comp, servicetest.FakeCredentialStore{})

	m := NewMillMCPService("0.0.0-test", comp, cfg, store, nil)
	if err := m.Start(addr); err != nil {
		t.Fatalf("Start: %v", err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = m.Shutdown(ctx)
	})

	wf, err := comp.CreateWorkflow(workflowLabel, "",
		[]composition.Node{{ID: "t", NodeTypeID: "trigger-manual"}, {ID: "c", NodeTypeID: "capture-clipboard-html"}},
		[]composition.Edge{{ID: "e1", Source: "t", Target: "c"}})
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}

	client := mcp.NewClient(&mcp.Implementation{Name: "mill-mcp-approval-test", Version: "0.0.0"}, nil)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	t.Cleanup(cancel)
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: "http://" + addr}, nil)
	if err != nil {
		t.Fatalf("client.Connect: %v", err)
	}
	t.Cleanup(func() { _ = session.Close() })

	if err := store.Set(MCPWriteEnabledKey, "true"); err != nil {
		t.Fatalf("set write key: %v", err)
	}
	// approval key left unset: required is the DEFAULT -- enabling
	// writes must not silently mean unattended writes.

	res, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "export_workflow", Arguments: map[string]any{"id": wf.ID}})
	if err != nil || res.IsError {
		t.Fatalf("export_workflow: err=%v res=%+v", err, res)
	}

	return &mcpApprovalHarness{
		store: store, comp: comp, cfg: cfg, svc: m, session: session, ctx: ctx,
		// id-stripped (ADR-0036 decision 3): these tests exercise the
		// import tool's create path, not the create-preserving-id/
		// update-in-place paths a real export's own id would now
		// trigger against the source workflow still sitting in comp.
		exported: stripJSONIDField(t, res.Content[0].(*mcp.TextContent).Text),
		before:   len(comp.Workflows()),
	}
}

// stripJSONIDField removes the top-level "id" key from a JSON object
// document -- forces ADR-0036 decision 3's fresh-create import path in
// a test whose exported payload would otherwise carry an id matching a
// still-present source entity (the update-in-place path).
func stripJSONIDField(t *testing.T, doc string) string {
	t.Helper()
	var raw map[string]any
	if err := json.Unmarshal([]byte(doc), &raw); err != nil {
		t.Fatalf("stripJSONIDField: invalid JSON: %v", err)
	}
	delete(raw, "id")
	out, err := json.Marshal(raw)
	if err != nil {
		t.Fatalf("stripJSONIDField: re-marshal: %v", err)
	}
	return string(out)
}

// callImport starts an import_workflow call in the background and
// returns a channel carrying its eventual result.
func (h *mcpApprovalHarness) callImport(t *testing.T) <-chan struct {
	res *mcp.CallToolResult
	err error
} {
	t.Helper()
	done := make(chan struct {
		res *mcp.CallToolResult
		err error
	}, 1)
	go func() {
		res, err := h.session.CallTool(h.ctx, &mcp.CallToolParams{
			Name: "import_workflow", Arguments: map[string]any{"json": h.exported},
		})
		done <- struct {
			res *mcp.CallToolResult
			err error
		}{res, err}
	}()
	return done
}

// awaitPending polls PendingMCPWrites until exactly one write is
// parked, returning it.
func (h *mcpApprovalHarness) awaitPending(t *testing.T) MCPWriteRequest {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if pending := h.svc.PendingMCPWrites(); len(pending) == 1 {
			return pending[0]
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("import never parked as a pending MCP write")
	return MCPWriteRequest{}
}

// Per-write approval, resolved WITHIN the courtesy window (docs/adr/0032
// §1): the co-present-approver case still resolves in a single MCP
// round trip, matching the pre-ADR-0032 synchronous shape for this
// case. Deny returns an error result and writes nothing; approve
// returns the write's own typed {id,label} result and creates the
// workflow. A third resolution of the same (now-approved) id proves
// at-most-once (docs/adr/0032 §1).
func TestMCPWriteTools_PerWriteApproval(t *testing.T) {
	h := newMCPApprovalHarness(t, "127.0.0.1:18092", "Approval test workflow")

	// Deny path: the tool returns an error result and nothing was written.
	done := h.callImport(t)
	if err := h.svc.ResolveMCPWrite(h.awaitPending(t).ID, false); err != nil {
		t.Fatalf("ResolveMCPWrite(deny): %v", err)
	}
	out := <-done
	if out.err != nil {
		t.Fatalf("CallTool transport error: %v", out.err)
	}
	if !out.res.IsError {
		t.Fatal("denied import must return an error result")
	}
	if len(h.comp.Workflows()) != h.before {
		t.Fatal("denied import must write nothing")
	}

	// Approve path: same call, resolved true this time.
	done = h.callImport(t)
	approvedID := h.awaitPending(t).ID
	if err := h.svc.ResolveMCPWrite(approvedID, true); err != nil {
		t.Fatalf("ResolveMCPWrite(approve): %v", err)
	}
	out = <-done
	if out.err != nil || out.res.IsError {
		t.Fatalf("approved import failed: err=%v res=%+v", out.err, out.res)
	}
	var imported importToolResult
	if err := json.Unmarshal([]byte(out.res.Content[0].(*mcp.TextContent).Text), &imported); err != nil {
		t.Fatalf("approved result is not the typed {id,label} JSON: %v", err)
	}
	if imported.Label != "Approval test workflow" {
		t.Errorf("imported label = %q, want the exported label", imported.Label)
	}
	if len(h.comp.Workflows()) != h.before+1 {
		t.Fatal("approved import must have created the workflow")
	}

	// At-most-once: resolving the same, now-approved id again must
	// error clearly and must NOT execute the write a second time.
	if err := h.svc.ResolveMCPWrite(approvedID, true); err == nil {
		t.Fatal("resolving an already-approved write a second time must error")
	}
	if len(h.comp.Workflows()) != h.before+1 {
		t.Fatal("double-resolve must not have written a second workflow")
	}
}

// extractParkedID pulls the id=<X> token out of gateWrite's own parked-
// pending text contract (docs/adr/0032 §1's exact wording).
func extractParkedID(t *testing.T, text string) string {
	t.Helper()
	const marker = "id="
	idx := strings.Index(text, marker)
	if idx < 0 {
		t.Fatalf("parked text has no id= marker: %s", text)
	}
	rest := text[idx+len(marker):]
	if end := strings.IndexByte(rest, ';'); end >= 0 {
		rest = rest[:end]
	}
	return strings.TrimSpace(rest)
}

// Past the courtesy window with nobody resolving yet: the call returns
// a SUCCESSFUL result (never an error -- an error would train the
// client to give up instead of polling) carrying the parked-pending
// text contract, and nothing has been written yet. check_write_status
// then reports pending, and a later ResolveMCPWrite executes the write
// exactly once -- check_write_status afterward reports approved with
// the write's own result text, and the workflow really exists.
func TestMCPWriteTools_CourtesyWindowExpiry_ParksThenPollable(t *testing.T) {
	orig := mcpWriteCourtesyWindow
	mcpWriteCourtesyWindow = 100 * time.Millisecond
	t.Cleanup(func() { mcpWriteCourtesyWindow = orig })

	h := newMCPApprovalHarness(t, "127.0.0.1:18093", "Courtesy window workflow")

	res, err := h.session.CallTool(h.ctx, &mcp.CallToolParams{
		Name: "import_workflow", Arguments: map[string]any{"json": h.exported},
	})
	if err != nil {
		t.Fatalf("CallTool transport error: %v", err)
	}
	if res.IsError {
		t.Fatalf("a still-undecided parked write must be a SUCCESSFUL result, got error: %+v", res.Content)
	}
	text := res.Content[0].(*mcp.TextContent).Text
	if !strings.Contains(text, "parked pending human approval") || !strings.Contains(text, "check_write_status") {
		t.Fatalf("unexpected parked text: %s", text)
	}
	if got := len(h.comp.Workflows()); got != h.before {
		t.Fatalf("workflow count = %d while still undecided, want %d (nothing may be written yet)", got, h.before)
	}
	id := extractParkedID(t, text)

	checkStatus := func() checkWriteStatusResult {
		t.Helper()
		sres, err := h.session.CallTool(h.ctx, &mcp.CallToolParams{Name: "check_write_status", Arguments: map[string]any{"id": id}})
		if err != nil || sres.IsError {
			t.Fatalf("check_write_status: err=%v res=%+v", err, sres)
		}
		var out checkWriteStatusResult
		if err := json.Unmarshal([]byte(sres.Content[0].(*mcp.TextContent).Text), &out); err != nil {
			t.Fatalf("check_write_status result is not the typed JSON: %v", err)
		}
		return out
	}

	if got := checkStatus(); got.Status != string(MCPWriteStatusPending) {
		t.Fatalf("check_write_status = %+v, want pending", got)
	}

	if err := h.svc.ResolveMCPWrite(id, true); err != nil {
		t.Fatalf("ResolveMCPWrite(approve): %v", err)
	}

	final := checkStatus()
	if final.Status != string(MCPWriteStatusApproved) {
		t.Fatalf("check_write_status after approval = %+v, want approved", final)
	}
	var imported importToolResult
	if err := json.Unmarshal([]byte(final.Result), &imported); err != nil {
		t.Fatalf("check_write_status.Result is not the typed {id,label} JSON: %v (result=%q)", err, final.Result)
	}
	if imported.Label != "Courtesy window workflow" {
		t.Errorf("approved result label = %q, want the exported label", imported.Label)
	}
	if got := len(h.comp.Workflows()); got != h.before+1 {
		t.Errorf("workflow count = %d after approval, want %d", got, h.before+1)
	}
}

// A pending write nobody ever resolves expires 24h after CreatedAt
// (docs/adr/0032 §1) -- shrunk here via the package var so the test
// doesn't sleep 24 real hours. Once expired: check_write_status reports
// "expired", resolving it errors (it's no longer pending), and nothing
// was ever written.
func TestMCPWriteTools_Expiry_MarksExpiredAndWritesNothing(t *testing.T) {
	origCourtesy, origExpiry := mcpWriteCourtesyWindow, mcpWriteExpiry
	mcpWriteCourtesyWindow = 20 * time.Millisecond
	mcpWriteExpiry = 60 * time.Millisecond
	t.Cleanup(func() { mcpWriteCourtesyWindow, mcpWriteExpiry = origCourtesy, origExpiry })

	h := newMCPApprovalHarness(t, "127.0.0.1:18094", "Expiry test workflow")

	res, err := h.session.CallTool(h.ctx, &mcp.CallToolParams{
		Name: "import_workflow", Arguments: map[string]any{"json": h.exported},
	})
	if err != nil || res.IsError {
		t.Fatalf("import_workflow (parking): err=%v res=%+v", err, res)
	}
	id := extractParkedID(t, res.Content[0].(*mcp.TextContent).Text)

	time.Sleep(200 * time.Millisecond) // well past mcpWriteExpiry

	sres, err := h.session.CallTool(h.ctx, &mcp.CallToolParams{Name: "check_write_status", Arguments: map[string]any{"id": id}})
	if err != nil || sres.IsError {
		t.Fatalf("check_write_status: err=%v res=%+v", err, sres)
	}
	var status checkWriteStatusResult
	if err := json.Unmarshal([]byte(sres.Content[0].(*mcp.TextContent).Text), &status); err != nil {
		t.Fatalf("check_write_status result is not the typed JSON: %v", err)
	}
	if status.Status != string(MCPWriteStatusExpired) {
		t.Fatalf("status = %+v, want expired", status)
	}

	if err := h.svc.ResolveMCPWrite(id, true); err == nil {
		t.Error("resolving an expired write must error")
	}
	if got := len(h.comp.Workflows()); got != h.before {
		t.Errorf("expired write must not have written anything, count=%d want %d", got, h.before)
	}
}

// The pending record is durable, not an in-process channel (docs/adr/0032
// §1's core claim): a fresh MillMCPService constructed against the same
// settings store -- simulating Mill restarting -- still lists the
// pending write and can approve it, executing the real write.
func TestMCPWriteTools_RestartSurvival_PendingRecordSurvivesNewServiceInstance(t *testing.T) {
	origCourtesy := mcpWriteCourtesyWindow
	mcpWriteCourtesyWindow = 50 * time.Millisecond
	defer func() { mcpWriteCourtesyWindow = origCourtesy }()

	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	cfg := configuresvc.NewConfigureService(store, comp, servicetest.FakeCredentialStore{})

	m1 := NewMillMCPService("0.0.0-test", comp, cfg, store, nil)
	if err := store.Set(MCPWriteEnabledKey, "true"); err != nil {
		t.Fatalf("set write key: %v", err)
	}

	wf, err := comp.CreateWorkflow("Restart survival workflow", "",
		[]composition.Node{{ID: "t", NodeTypeID: "trigger-manual"}, {ID: "c", NodeTypeID: "capture-clipboard-html"}},
		[]composition.Edge{{ID: "e1", Source: "t", Target: "c"}})
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}
	exported, err := comp.ExportWorkflow(wf.ID)
	if err != nil {
		t.Fatalf("ExportWorkflow: %v", err)
	}
	before := len(comp.Workflows())

	// id-stripped (ADR-0036 decision 3): exercises the create path, not
	// the update-in-place path a real matching id would now trigger
	// against wf, which is still present in comp.
	argsJSON, err := marshalArgs(importToolArgs{JSON: stripJSONIDField(t, exported)})
	if err != nil {
		t.Fatalf("marshalArgs: %v", err)
	}
	mcpDone := make(chan struct{})
	go func() {
		_, _ = m1.gateWrite("import_workflow", "restart survival test import", argsJSON)
		close(mcpDone)
	}()

	deadline := time.Now().Add(2 * time.Second)
	var id string
	for time.Now().Before(deadline) {
		if p := m1.PendingMCPWrites(); len(p) == 1 {
			id = p[0].ID
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if id == "" {
		t.Fatal("write never parked on the original instance")
	}

	// A fresh service instance against the SAME store, standing in for
	// main.go reconstructing everything from the same settings.json
	// after a restart.
	m2 := NewMillMCPService("0.0.0-test", comp, cfg, store, nil)
	pending := m2.PendingMCPWrites()
	if len(pending) != 1 || pending[0].ID != id {
		t.Fatalf("pending write did not survive across service instances: %+v", pending)
	}

	if err := m2.ResolveMCPWrite(id, true); err != nil {
		t.Fatalf("ResolveMCPWrite on the restarted instance: %v", err)
	}
	if got := len(comp.Workflows()); got != before+1 {
		t.Errorf("workflow count = %d after restart-survived approval, want %d", got, before+1)
	}

	select {
	case <-mcpDone:
	case <-time.After(2 * time.Second):
		t.Log("original instance's gateWrite call did not return before test end (harmless: its own courtesy window simply elapsed on an id nobody there ever resolved)")
	}
}

// docs/goals/0025 items 1/2: persistWritesLocked used to swallow its
// error (`_ = m.store.Set(...)`), so a failed durable park looked
// exactly like a successful one to the caller, and a failed resolution
// record looked like nothing had gone wrong at all. Called directly
// (bypassing the real HTTP/MCP-client harness the other tests in this
// file use) since gateWrite/ResolveMCPWrite are plain unexported
// methods here in-package -- no server needs to be running to exercise
// the park-and-poll persistence path itself.

func TestGateWrite_PersistFailureAtParkTime_ReturnsErrorAndLeavesNoRecord(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	cfg := configuresvc.NewConfigureService(store, comp, servicetest.FakeCredentialStore{})
	m := NewMillMCPService("0.0.0-test", comp, cfg, store, nil)

	// approvalRequired() defaults to true with nothing set -- gateWrite
	// takes the park path, which is where the persist call under test
	// lives; it fails before ever reaching the courtesy-window wait, so
	// this returns immediately regardless of mcpWriteCourtesyWindow.
	store.SetErr = errFakeMCPPersist
	res, err := m.gateWrite("some_tool", "a test write that should never durably park", "{}")
	if err == nil {
		t.Fatalf("gateWrite() with a failing store: want error, got nil (res=%+v)", res)
	}

	store.SetErr = nil
	if pending := m.PendingMCPWrites(); len(pending) != 0 {
		t.Errorf("PendingMCPWrites() after a failed park = %+v, want empty -- a write that failed to durably persist must not sit in memory looking parked", pending)
	}
}

// TestResolveMCPWrite_PersistFailure_StillDeniesButReturnsError covers
// the DENY path specifically (not approve): denying has no real side
// effect to worry about re-running, so this is the case where
// finalizeLocked's own deliberate no-rollback choice is safe to assert
// directly -- the decision still applies in memory (Status flips to
// denied) even though the durable record of it failed to save, and
// that failure is still surfaced to the caller rather than swallowed.
func TestResolveMCPWrite_PersistFailure_StillDeniesButReturnsError(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	cfg := configuresvc.NewConfigureService(store, comp, servicetest.FakeCredentialStore{})
	m := NewMillMCPService("0.0.0-test", comp, cfg, store, nil)

	mcpWriteCourtesyWindow = 10 * time.Millisecond
	t.Cleanup(func() { mcpWriteCourtesyWindow = 10 * time.Second })

	done := make(chan struct{})
	go func() {
		defer close(done)
		_, _ = m.gateWrite("some_tool", "a test write to deny", "{}")
	}()

	var id string
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if pending := m.PendingMCPWrites(); len(pending) == 1 {
			id = pending[0].ID
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if id == "" {
		t.Fatal("write never parked")
	}
	<-done // let the courtesy window elapse so gateWrite's own call returns

	store.SetErr = errFakeMCPPersist
	err := m.ResolveMCPWrite(id, false)
	if err == nil {
		t.Fatal("ResolveMCPWrite(deny) with a failing store: want error, got nil")
	}
	store.SetErr = nil

	status, ok := m.writeStatus(id)
	if !ok {
		t.Fatal("writeStatus after a failed-to-persist denial: record disappeared entirely")
	}
	if status.Status != string(MCPWriteStatusDenied) {
		t.Errorf("writeStatus.Status = %q, want %q -- the denial decision itself is real even though it failed to durably save", status.Status, MCPWriteStatusDenied)
	}
}
