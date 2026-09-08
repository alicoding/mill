package triggersvc

import (
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/executionsvc"
)

// respond-webhook's proof lives here for the same reason
// webhook_seed_test.go's own header comment gives: only this package
// can wire a TriggerService to a real ExecutionService without
// inverting the import direction.

// testRespondBudgetSeconds is every newWebhookRespondWorkflow caller's
// own budget -- none of these tests exercises a DIFFERENT budget value
// (the dedicated budget-elapsed/prompt-fallback cases build their own
// workflow inline instead), so this stays a shared constant rather
// than a parameter every call site would pass identically.
const testRespondBudgetSeconds = "5"

// newWebhookRespondWorkflow builds a published trigger-webhook ->
// apply-respond-webhook listener and returns its id.
func newWebhookRespondWorkflow(t *testing.T, comp *compositionsvc.CompositionService, label, source, status, body string) string {
	t.Helper()
	triggerID := label + "-trigger"
	respondID := label + "-respond"
	wf, err := comp.CreateWorkflow(label, "", []composition.Node{
		{ID: triggerID, NodeTypeID: "trigger-webhook", Config: map[string]string{"source": source, "respondWithinSeconds": testRespondBudgetSeconds}},
		{ID: respondID, NodeTypeID: composition.RespondWebhookNodeTypeID, Config: map[string]string{"status": status, "body": body, "contentType": "application/json"}},
	}, []composition.Edge{{ID: label + "-e0", Source: triggerID, Target: respondID}})
	if err != nil {
		t.Fatalf("CreateWorkflow(%s): %v", label, err)
	}
	if _, err := comp.PublishWorkflow(wf.ID); err != nil {
		t.Fatalf("PublishWorkflow(%s): %v", label, err)
	}
	return wf.ID
}

// awaitReply reads wait's one reply within a bounded window, failing
// the test rather than hanging forever if dispatch never answers.
func awaitReply(t *testing.T, wait *WebhookWait, within time.Duration) WebhookReply {
	t.Helper()
	select {
	case reply := <-wait.Reply:
		return reply
	case <-time.After(within):
		t.Fatal("no reply arrived within the test's own wait window")
		return WebhookReply{}
	}
}

// TestWebhookDispatch_NoRespondNode_ReturnsNilWait proves goal 0373
// design contract item 3's byte-identical-ACK case: a listener with no
// respond-webhook node never makes the ingress wait at all.
func TestWebhookDispatch_NoRespondNode_ReturnsNilWait(t *testing.T) {
	comp, trig, _, _ := newSystemEventHarness(t)
	newWebhookWorkflow(t, comp, "webhook-plain", "plain-src")
	trig.Sync(comp.Workflows())

	wait := trig.DispatchWebhookEvent(map[string]string{"source": "plain-src"}, []byte(`{"source":"plain-src"}`))
	if wait != nil {
		t.Fatal("DispatchWebhookEvent returned a wait for a listener with no respond-webhook node, want nil")
	}
}

// TestWebhookDispatch_RespondingWorkflow_DeliversReply proves the
// respond step's reply reaches the ingress with its own status/body/
// content-type, and that the wait's Budget is the listener's own
// respondWithinSeconds.
func TestWebhookDispatch_RespondingWorkflow_DeliversReply(t *testing.T) {
	comp, trig, exec, _ := newSystemEventHarness(t)
	wfID := newWebhookRespondWorkflow(t, comp, "webhook-reply", "reply-src", "201", `{"ok":true}`)
	trig.Sync(comp.Workflows())

	wait := trig.DispatchWebhookEvent(map[string]string{"source": "reply-src"}, []byte(`{"source":"reply-src"}`))
	if wait == nil {
		t.Fatal("DispatchWebhookEvent returned nil, want a wait for a respond-webhook listener")
	}
	if wait.Budget != 5*time.Second {
		t.Errorf("Budget = %v, want 5s (the listener's own respondWithinSeconds)", wait.Budget)
	}
	reply := awaitReply(t, wait, 5*time.Second)
	if reply.Status != 201 || reply.Body != `{"ok":true}` || reply.ContentType != "application/json" {
		t.Errorf("reply = %+v, want {201 application/json {\"ok\":true}}", reply)
	}

	if got := awaitRuns(t, exec, wfID, 1); got != 1 {
		t.Fatalf("responding workflow: %d runs, want 1", got)
	}
}

// TestWebhookDispatch_FirstWinsAcrossListeners proves goal 0373 design
// contract item 3's cross-run first-wins rule: two listeners armed for
// the same source both run, but only the FIRST reply answers the
// caller -- and the other's own run still completes (its Record isn't
// skipped just because it lost the race).
func TestWebhookDispatch_FirstWinsAcrossListeners(t *testing.T) {
	comp, trig, exec, _ := newSystemEventHarness(t)
	wfA := newWebhookRespondWorkflow(t, comp, "webhook-race-a", "race-src", "201", "A-BODY")
	wfB := newWebhookRespondWorkflow(t, comp, "webhook-race-b", "race-src", "202", "B-BODY")
	trig.Sync(comp.Workflows())

	wait := trig.DispatchWebhookEvent(map[string]string{"source": "race-src"}, []byte(`{"source":"race-src"}`))
	if wait == nil {
		t.Fatal("DispatchWebhookEvent returned nil, want a wait")
	}
	reply := awaitReply(t, wait, 5*time.Second)
	if reply.Body != "A-BODY" && reply.Body != "B-BODY" {
		t.Fatalf("reply.Body = %q, want either race workflow's own body", reply.Body)
	}

	// Both runs complete regardless of which one won the HTTP race.
	if got := awaitRuns(t, exec, wfA, 1); got != 1 {
		t.Errorf("workflow A: %d runs, want 1 (its own run completes even if it lost the race)", got)
	}
	if got := awaitRuns(t, exec, wfB, 1); got != 1 {
		t.Errorf("workflow B: %d runs, want 1 (its own run completes even if it lost the race)", got)
	}
}

// TestWebhookDispatch_TerminalWithoutReply_PromptFallback proves goal
// 0373 design contract item 3's "every waited run reaches a terminal
// status without replying" case: a respond-webhook node the run's own
// branch never reaches still lets the listener's graph qualify for a
// wait, but the ingress answers PROMPTLY (well under the budget) with
// the Status-0 sentinel once the run finishes.
func TestWebhookDispatch_TerminalWithoutReply_PromptFallback(t *testing.T) {
	comp, trig, _, _ := newSystemEventHarness(t)
	const (
		triggerID = "skip-trigger"
		routeID   = "skip-route"
		respondID = "skip-respond"
		otherID   = "skip-other"
	)
	wf, err := comp.CreateWorkflow("webhook-skip", "", []composition.Node{
		{ID: triggerID, NodeTypeID: "trigger-webhook", Config: map[string]string{"source": "skip-src", "respondWithinSeconds": "30"}},
		{ID: routeID, NodeTypeID: "decision-route"},
		{ID: respondID, NodeTypeID: composition.RespondWebhookNodeTypeID, Config: map[string]string{"status": "200", "body": "never sent"}},
		{ID: otherID, NodeTypeID: "process-inject-text", Config: map[string]string{"text": "skipped", "placement": "append"}},
	}, []composition.Edge{
		{ID: "skip-e0", Source: triggerID, Target: routeID},
		{ID: "skip-e1", Source: routeID, Target: respondID, SourceHandle: "1 == 2"},
		{ID: "skip-e2", Source: routeID, Target: otherID, SourceHandle: "otherwise"},
	})
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}
	if _, err := comp.PublishWorkflow(wf.ID); err != nil {
		t.Fatalf("PublishWorkflow: %v", err)
	}
	trig.Sync(comp.Workflows())

	start := time.Now()
	wait := trig.DispatchWebhookEvent(map[string]string{"source": "skip-src"}, []byte(`{"source":"skip-src"}`))
	if wait == nil {
		t.Fatal("DispatchWebhookEvent returned nil, want a wait (the graph contains a respond-webhook node)")
	}
	reply := awaitReply(t, wait, 10*time.Second)
	elapsed := time.Since(start)
	if reply.Status != 0 {
		t.Errorf("reply.Status = %d, want 0 (the sentinel: the run finished without ever calling Reply)", reply.Status)
	}
	if elapsed >= wait.Budget {
		t.Errorf("the prompt fallback took %v, want well under the %v budget (goal 0373: never wait for a run that already finished)", elapsed, wait.Budget)
	}
}

// TestWebhookDispatch_ParkedRun_KeepsWaitingUntilBudget proves goal
// 0373 design contract item 5: a run parked on an approval (human-review
// always parks, docs/adr/0023) never fires the ingress's own "terminal,
// nobody will answer" sentinel -- it stays outstanding until the
// caller's own budget, the mediation case this goal exists for.
func TestWebhookDispatch_ParkedRun_KeepsWaitingUntilBudget(t *testing.T) {
	comp, trig, _, _ := newSystemEventHarness(t)
	const (
		triggerID = "park-trigger"
		reviewID  = "park-review"
		respondID = "park-respond"
	)
	wf, err := comp.CreateWorkflow("webhook-park", "", []composition.Node{
		{ID: triggerID, NodeTypeID: "trigger-webhook", Config: map[string]string{"source": "park-src", "respondWithinSeconds": "30"}},
		{ID: reviewID, NodeTypeID: "human-review"},
		{ID: respondID, NodeTypeID: composition.RespondWebhookNodeTypeID, Config: map[string]string{"status": "200", "body": "after approval"}},
	}, []composition.Edge{
		{ID: "park-e0", Source: triggerID, Target: reviewID},
		{ID: "park-e1", Source: reviewID, Target: respondID},
	})
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}
	if _, err := comp.PublishWorkflow(wf.ID); err != nil {
		t.Fatalf("PublishWorkflow: %v", err)
	}
	trig.Sync(comp.Workflows())

	wait := trig.DispatchWebhookEvent(map[string]string{"source": "park-src"}, []byte(`{"source":"park-src"}`))
	if wait == nil {
		t.Fatal("DispatchWebhookEvent returned nil, want a wait")
	}
	select {
	case reply := <-wait.Reply:
		t.Fatalf("got a reply %+v while the run is parked awaiting approval, want the wait to stay open until the budget", reply)
	case <-time.After(500 * time.Millisecond):
		// Still open, as designed: a park is never mistaken for "the
		// run finished without replying."
	}
}

// TestWebhookDispatch_ClientDisconnect_RunsContinue proves the
// divergence list's own rule: a caller that never reads its reply
// (modeled here by never selecting on wait.Reply at all) doesn't stop
// the run from finishing and recording its own Reply.
func TestWebhookDispatch_ClientDisconnect_RunsContinue(t *testing.T) {
	comp, trig, exec, _ := newSystemEventHarness(t)
	wfID := newWebhookRespondWorkflow(t, comp, "webhook-disconnect", "disconnect-src", "200", "still runs")
	trig.Sync(comp.Workflows())

	wait := trig.DispatchWebhookEvent(map[string]string{"source": "disconnect-src"}, []byte(`{"source":"disconnect-src"}`))
	if wait == nil {
		t.Fatal("DispatchWebhookEvent returned nil, want a wait")
	}
	// Deliberately never read wait.Reply -- the "caller vanished"
	// case (goal 0373's own divergence note: "the responder becomes a
	// no-op", never a run abort).
	if got := awaitRuns(t, exec, wfID, 1); got != 1 {
		t.Fatalf("workflow: %d runs, want 1 (the run finishes even though nobody read its reply)", got)
	}
}

// TestWebhookDispatch_SecondRespondInSameRun_IgnoredWithNote proves
// goal 0373 design contract item 2: a second respond-webhook node in
// the SAME run is ignored (first-wins within the run) and records a
// run note naming the step that already answered, rather than
// double-replying.
func TestWebhookDispatch_SecondRespondInSameRun_IgnoredWithNote(t *testing.T) {
	comp, trig, exec, _ := newSystemEventHarness(t)
	const (
		triggerID  = "double-trigger"
		respond1ID = "double-respond-1"
		respond2ID = "double-respond-2"
	)
	wf, err := comp.CreateWorkflow("webhook-double", "", []composition.Node{
		{ID: triggerID, NodeTypeID: "trigger-webhook", Config: map[string]string{"source": "double-src", "respondWithinSeconds": "5"}},
		{ID: respond1ID, NodeTypeID: composition.RespondWebhookNodeTypeID, Config: map[string]string{"status": "200", "body": "first"}},
		{ID: respond2ID, NodeTypeID: composition.RespondWebhookNodeTypeID, Config: map[string]string{"status": "200", "body": "second"}},
	}, []composition.Edge{
		{ID: "double-e0", Source: triggerID, Target: respond1ID},
		{ID: "double-e1", Source: respond1ID, Target: respond2ID},
	})
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}
	if _, err := comp.PublishWorkflow(wf.ID); err != nil {
		t.Fatalf("PublishWorkflow: %v", err)
	}
	trig.Sync(comp.Workflows())

	wait := trig.DispatchWebhookEvent(map[string]string{"source": "double-src"}, []byte(`{"source":"double-src"}`))
	reply := awaitReply(t, wait, 5*time.Second)
	if reply.Body != "first" {
		t.Errorf("reply.Body = %q, want %q (the FIRST respond-webhook node wins)", reply.Body, "first")
	}

	if awaitRuns(t, exec, wf.ID, 1) != 1 {
		t.Fatal("the double-respond workflow never completed")
	}
	runs, err := exec.ListRunsForWorkflow(wf.ID)
	if err != nil || len(runs) == 0 {
		t.Fatalf("ListRunsForWorkflow: %v", err)
	}
	detail, err := exec.GetRun(runs[0].RunID)
	if err != nil {
		t.Fatalf("GetRun: %v", err)
	}
	var sawNote bool
	for _, step := range detail.Steps {
		if step.NodeID == respond2ID {
			note, _ := step.OutputAttributes["webhookReplyNote"].(string)
			if note == "" {
				t.Errorf("second respond step's OutputAttributes[webhookReplyNote] is empty, want a note naming the step that already answered")
			}
			sawNote = true
		}
	}
	if !sawNote {
		t.Fatal("never found the second respond-webhook step's recorded output")
	}
}

// TestExecRespondWebhook_NoResponder_RecordsNoCallerNote proves goal
// 0373 design contract item 2's other exceptional case: a
// respond-webhook step OUTSIDE a webhook-started run (nothing to
// answer) is a no-op that records "No caller to answer.", never a
// panic or a run failure.
func TestExecRespondWebhook_NoResponder_RecordsNoCallerNote(t *testing.T) {
	comp, _, exec, _ := newSystemEventHarness(t)
	const respondID = "manual-respond"
	wf, err := comp.CreateWorkflow("manual-answer", "", []composition.Node{
		{ID: "manual-trigger", NodeTypeID: "trigger-manual"},
		{ID: respondID, NodeTypeID: composition.RespondWebhookNodeTypeID, Config: map[string]string{"status": "200", "body": "unreachable"}},
	}, []composition.Edge{{ID: "manual-e0", Source: "manual-trigger", Target: respondID}})
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}

	summary, err := exec.RunWorkflow(wf.ID, executionsvc.RunKindTest, nil)
	if err != nil || summary.Error != "" {
		t.Fatalf("RunWorkflow: summary=%+v err=%v", summary, err)
	}
	detail, err := exec.GetRun(summary.RunID)
	if err != nil {
		t.Fatalf("GetRun: %v", err)
	}
	for _, step := range detail.Steps {
		if step.NodeID == respondID {
			note, _ := step.OutputAttributes["webhookReplyNote"].(string)
			if note != "No caller to answer." {
				t.Errorf("OutputAttributes[webhookReplyNote] = %q, want %q", note, "No caller to answer.")
			}
			return
		}
	}
	t.Fatal("never found the respond-webhook step's recorded output")
}
