package triggersvc

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/guardrail"
	"github.com/alicoding/mill/internal/domain/httprequest"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/executionsvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// docs/adr/0035: trigger-system-event's proof at the layer that actually
// wires ExecutionService's emission to TriggerService's dispatch --
// executionsvc can't construct a *TriggerService (that would be the
// reverse of the real import direction, .claude/rules/backend.md), so
// these tests live here, mirroring filesystemwatch_seed_test.go's own
// "this package needs both services wired together" reasoning.

// newSystemEventHarness builds a comp/trig/exec triple wired exactly like
// main.go: comp.SetSyncer(trig), trig.SetExecutionService(exec),
// exec.SetSystemEventSink(trig.DispatchSystemEvent). Shared setup for
// every test in this file.
func newSystemEventHarness(t *testing.T) (*compositionsvc.CompositionService, *TriggerService, *executionsvc.ExecutionService, *guardrailsvc.GuardrailService) {
	t.Helper()
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	trig := NewTriggerService(comp, slog.Default(), store)
	comp.SetSyncer(trig)

	guard := guardrailsvc.NewGuardrailService(store, comp)
	dbPath := filepath.Join(t.TempDir(), "exec.db")
	exec, err := executionsvc.NewExecutionService("sqlite:"+dbPath, comp, guard)
	if err != nil {
		t.Fatalf("NewExecutionService: %v", err)
	}
	trig.SetExecutionService(exec)
	exec.SetSystemEventSink(trig.DispatchSystemEvent)
	t.Cleanup(func() {
		trig.Sync(nil) // stop every listener this test starts
		_ = exec.Shutdown(2 * time.Second)
	})
	return comp, trig, exec, guard
}

// swapHTTPRequestLookup installs fn as composition's HTTP-request lookup
// seam and returns a restore function -- same shape as
// executionsvc.swapHTTPRequestLookup (unexported there, so duplicated
// here rather than exporting a test-only helper across a package
// boundary for one caller).
func swapHTTPRequestLookup(t *testing.T, fn func(id string) (composition.ResolvedHTTPRequest, error)) {
	t.Helper()
	composition.SetHTTPRequestLookup(fn)
	t.Cleanup(func() {
		composition.SetHTTPRequestLookup(func(requestID string) (composition.ResolvedHTTPRequest, error) {
			return composition.ResolvedHTTPRequest{}, fmt.Errorf("no request lookup registered (yet) for id %q", requestID)
		})
	})
}

// guardrailAllowRule scopes an EffectAllow rule to one exact node
// instance (ADR-0019's third scope) -- WorkflowID+NodeID both set, so it
// never accidentally vouches for any OTHER node of the same NodeTypeID.
func guardrailAllowRule(label, workflowID, nodeID string) guardrail.Rule {
	return guardrail.Rule{Label: label, Effect: guardrail.EffectAllow, WorkflowID: workflowID, NodeID: nodeID}
}

func findWorkflowByLabel(t *testing.T, comp *compositionsvc.CompositionService, label string) composition.Workflow {
	t.Helper()
	for _, wf := range comp.Workflows() {
		if wf.Label == label {
			return wf
		}
	}
	t.Fatalf("no built-in workflow labeled %q", label)
	return composition.Workflow{}
}

// TestSeededForwardApprovalsExample_DecisionParked_PostsRealHTTPCall is
// the goal's own cited proof: enable the REAL seeded "Example: Forward
// pending approvals" workflow (docs/adr/0035 item 5, ForwardPendingApproval's
// composed replacement) against a fixture HTTP server, park a real run on
// a different workflow (the seeded guarded-HTTP example, which parks
// awaiting approval by default), and confirm the forward workflow's
// integration-http step actually POSTs the decision-parked system event
// -- proving the whole chain end to end: guardrail park -> emitSystemEvent
// -> TriggerService.DispatchSystemEvent -> a real second DBOS run ->
// integration.go's ctx.Payload body fallback -> a real HTTP call.
func TestSeededForwardApprovalsExample_DecisionParked_PostsRealHTTPCall(t *testing.T) {
	comp, _, exec, guard := newSystemEventHarness(t)

	var hits int32
	var body []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		body = b
		atomic.AddInt32(&hits, 1)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	swapHTTPRequestLookup(t, func(id string) (composition.ResolvedHTTPRequest, error) {
		if id != httprequest.ExampleNoneID {
			t.Errorf("lookupHTTPRequestFn called with id %q, want the seed's real requestId %q", id, httprequest.ExampleNoneID)
		}
		return composition.ResolvedHTTPRequest{BaseURL: srv.URL, AuthType: httprequest.AuthNone}, nil
	})

	forward := findWorkflowByLabel(t, comp, "Example: Forward pending approvals")
	if !forward.Disabled {
		t.Fatal("the forward example should ship Disabled, matching every other real-event-driven seed")
	}
	var forwardHTTPNodeID string
	for _, n := range forward.Nodes {
		if n.NodeTypeID == "integration-http" {
			forwardHTTPNodeID = n.ID
		}
	}
	if forwardHTTPNodeID == "" {
		t.Fatal("the forward example has no integration-http node")
	}
	// integration-http is ClassExternal, so it asks for approval by
	// default (SPEC.md §8) same as the guarded-HTTP example below --
	// exactly what the seed's own Description tells a real user to do
	// ("add an allow rule under Configure > Guardrails") once they've
	// re-pointed it at a real endpoint they trust to fire unattended.
	// Scoped to this ONE node (not NodeTypeID-wide) so the OTHER
	// integration-http node below (the guarded-HTTP source) still parks
	// -- that park is the very event this test is proving gets forwarded.
	if _, err := guard.CreateRule(guardrailAllowRule("forward is trusted", forward.ID, forwardHTTPNodeID)); err != nil {
		t.Fatalf("CreateRule: %v", err)
	}
	if _, err := comp.SetWorkflowDisabled(forward.ID, false); err != nil {
		t.Fatalf("SetWorkflowDisabled(false): %v", err)
	}
	if _, err := comp.PublishWorkflow(forward.ID); err != nil {
		t.Fatalf("PublishWorkflow: %v", err)
	}

	guarded := findWorkflowByLabel(t, comp, "Example: Approval-gated HTTP call")
	summary, err := exec.RunWorkflow(guarded.ID, executionsvc.RunKindTest, nil)
	if err != nil {
		t.Fatalf("RunWorkflow(guarded): %v", err)
	}

	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) && atomic.LoadInt32(&hits) == 0 {
		time.Sleep(50 * time.Millisecond)
	}
	if atomic.LoadInt32(&hits) == 0 {
		t.Fatal("the forward workflow's integration-http step never called the fixture server")
	}

	var ev executionsvc.SystemEvent
	if err := json.Unmarshal(body, &ev); err != nil {
		t.Fatalf("POST body is not the expected SystemEvent JSON: %v (body=%s)", err, body)
	}
	if ev.Event != executionsvc.SystemEventDecisionParked {
		t.Errorf("ev.Event = %q, want %q", ev.Event, executionsvc.SystemEventDecisionParked)
	}
	if ev.RunID != summary.RunID {
		t.Errorf("ev.RunID = %q, want the parked run's own ID %q", ev.RunID, summary.RunID)
	}
	if ev.WorkflowID != guarded.ID {
		t.Errorf("ev.WorkflowID = %q, want the parked workflow's ID %q", ev.WorkflowID, guarded.ID)
	}
	if ev.WorkflowLabel != guarded.Label {
		t.Errorf("ev.WorkflowLabel = %q, want %q", ev.WorkflowLabel, guarded.Label)
	}
	if ev.NodeID == "" {
		t.Error("ev.NodeID is empty, want the parked node's ID")
	}
}

// TestSystemEvent_LoopRule_SystemEventTriggeredRunEmitsNothing proves
// docs/adr/0035 item 4's loop rule: a run whose OWN root trigger is
// trigger-system-event never emits a system event of its own. Builds a
// minimal workflow rooted in trigger-system-event(run-completed),
// self-scoped ("all" workflows, which includes itself) -- if the loop
// rule didn't hold, running it once would emit run-completed, which
// (matching "all") would re-fire itself, which would complete and emit
// again, runaway. Asserting the run count stays at exactly 1 after a
// bounded wait proves the chain never starts.
func TestSystemEvent_LoopRule_SystemEventTriggeredRunEmitsNothing(t *testing.T) {
	comp, _, exec, _ := newSystemEventHarness(t)

	const triggerID = "sysevent-loop-trigger"
	const injectID = "sysevent-loop-inject"
	wf, err := comp.CreateWorkflow("Loop-rule probe", "", []composition.Node{
		{ID: triggerID, NodeTypeID: "trigger-system-event", Config: map[string]string{"event": "run-completed", "workflowScope": ""}},
		{ID: injectID, NodeTypeID: "process-inject-text", Config: map[string]string{"text": "fired", "placement": "append"}},
	}, []composition.Edge{{ID: "e0", Source: triggerID, Target: injectID}})
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}
	if _, err := comp.PublishWorkflow(wf.ID); err != nil {
		t.Fatalf("PublishWorkflow: %v", err)
	}

	if _, err := exec.RunWorkflow(wf.ID, executionsvc.RunKindTest, nil); err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}

	// Bounded settle window: a runaway loop would produce a second run
	// almost immediately (no network, no approval wait -- process-
	// inject-text is synchronous). 1s is generous for a fake-store,
	// in-process DBOS sqlite run.
	time.Sleep(1 * time.Second)

	runs, err := exec.ListRunsForWorkflow(wf.ID)
	if err != nil {
		t.Fatalf("ListRunsForWorkflow: %v", err)
	}
	if len(runs) != 1 {
		t.Fatalf("got %d runs for the self-scoped system-event workflow after one manual run, want exactly 1 (the loop rule should have suppressed any further emission)", len(runs))
	}
}

// TestSystemEvent_RunCompleted_FiresForManualAndTriggeredRuns proves
// run-completed emits identically regardless of RunKind (docs/adr/0035
// item 2's "cover BOTH so every run kind emits") -- a manual test run
// (RunKindTest, Composition's own Run button) and a headless trigger
// fire (RunKindTriggered, TriggerService.fire) both complete through the
// same runWorkflow function (executionservice.go), so one emission point
// there covers both, rather than needing a second call site per RunKind.
func TestSystemEvent_RunCompleted_FiresForManualAndTriggeredRuns(t *testing.T) {
	comp, trig, exec, _ := newSystemEventHarness(t)

	var completions int32
	const listenerTriggerID = "sysevent-completed-trigger"
	const listenerInjectID = "sysevent-completed-inject"
	listener, err := comp.CreateWorkflow("run-completed listener", "", []composition.Node{
		{ID: listenerTriggerID, NodeTypeID: "trigger-system-event", Config: map[string]string{"event": "run-completed", "workflowScope": ""}},
		{ID: listenerInjectID, NodeTypeID: "process-inject-text", Config: map[string]string{"text": "seen", "placement": "append"}},
	}, []composition.Edge{{ID: "e0", Source: listenerTriggerID, Target: listenerInjectID}})
	if err != nil {
		t.Fatalf("CreateWorkflow(listener): %v", err)
	}
	if _, err := comp.PublishWorkflow(listener.ID); err != nil {
		t.Fatalf("PublishWorkflow(listener): %v", err)
	}

	const sourceTriggerID = "sysevent-source-trigger"
	source, err := comp.CreateWorkflow("run-completed source", "", []composition.Node{
		{ID: sourceTriggerID, NodeTypeID: "trigger-manual"},
	}, nil)
	if err != nil {
		t.Fatalf("CreateWorkflow(source): %v", err)
	}
	if _, err := comp.PublishWorkflow(source.ID); err != nil {
		t.Fatalf("PublishWorkflow(source): %v", err)
	}

	countListenerRuns := func() int32 {
		runs, err := exec.ListRunsForWorkflow(listener.ID)
		if err != nil {
			t.Fatalf("ListRunsForWorkflow(listener): %v", err)
		}
		n := 0
		for _, r := range runs {
			if r.Status == "SUCCESS" {
				n++
			}
		}
		return int32(n)
	}

	// A manual test run of source.
	if _, err := exec.RunWorkflow(source.ID, executionsvc.RunKindTest, nil); err != nil {
		t.Fatalf("RunWorkflow(source, test): %v", err)
	}
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) && countListenerRuns() < 1 {
		time.Sleep(50 * time.Millisecond)
	}
	if got := countListenerRuns(); got < 1 {
		t.Fatalf("after a manual run of source, listener has %d successful runs, want >= 1", got)
	}
	completions = countListenerRuns()

	// A headless trigger fire of source -- s.fire is this package's own
	// private method (triggerservice.go), the exact call every real
	// listener (hotkey/schedule/clipboard/filesystem-watch) makes; calling
	// it directly here simulates "a real trigger fired this run" without
	// needing a live OS listener in a unit test.
	trig.fire(source.ID, "", "")
	deadline = time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) && countListenerRuns() <= completions {
		time.Sleep(50 * time.Millisecond)
	}
	if got := countListenerRuns(); got <= completions {
		t.Fatalf("after a triggered run of source, listener has %d successful runs (was %d after the manual run), want strictly more", got, completions)
	}
}
