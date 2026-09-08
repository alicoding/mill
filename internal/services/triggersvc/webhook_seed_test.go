package triggersvc

import (
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/executionsvc"
)

// trigger-webhook's proof lives here for the same reason
// trigger-system-event's does (systemevent_seed_test.go's header
// comment): only this package can wire a TriggerService to a real
// ExecutionService without inverting the import direction.

// newWebhookWorkflow builds a published, armed trigger-webhook
// listener workflow and returns its id -- the setup half every webhook
// dispatch test shares.
func newWebhookWorkflow(t *testing.T, comp *compositionsvc.CompositionService, label, source string) string {
	t.Helper()
	triggerID := label + "-trigger"
	injectID := label + "-inject"
	wf, err := comp.CreateWorkflow(label, "", []composition.Node{
		{ID: triggerID, NodeTypeID: "trigger-webhook", Config: map[string]string{"source": source}},
		{ID: injectID, NodeTypeID: "process-inject-text", Config: map[string]string{"text": "seen", "placement": "append"}},
	}, []composition.Edge{{ID: label + "-e0", Source: triggerID, Target: injectID}})
	if err != nil {
		t.Fatalf("CreateWorkflow(%s): %v", label, err)
	}
	if _, err := comp.PublishWorkflow(wf.ID); err != nil {
		t.Fatalf("PublishWorkflow(%s): %v", label, err)
	}
	return wf.ID
}

// completedRuns counts wfID's runs that have reached a terminal state
// so far -- RunSummary.StillRunning(), never a bare Error=="" check:
// Error is empty for a run still PENDING/ENQUEUED just as much as for a
// real success, so a caller that raced a fresh run's own DB row against
// its later steps (goal 0395's TestWebhookDispatch_SecondRespondInSameRun
// flake -- respond2's step read back "pending" the moment respond1's
// alone had landed) would undercount how much of the graph actually ran.
func completedRuns(t *testing.T, exec *executionsvc.ExecutionService, wfID string) int {
	t.Helper()
	runs, err := exec.ListRunsForWorkflow(wfID)
	if err != nil {
		t.Fatalf("ListRunsForWorkflow: %v", err)
	}
	n := 0
	for _, run := range runs {
		if !run.StillRunning() {
			n++
		}
	}
	return n
}

// awaitRuns polls until wfID reaches want completed runs, failing past
// the deadline -- a dispatched fire runs async, so a bare sleep would
// flake.
func awaitRuns(t *testing.T, exec *executionsvc.ExecutionService, wfID string, want int) int {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) && completedRuns(t, exec, wfID) < want {
		time.Sleep(50 * time.Millisecond)
	}
	return completedRuns(t, exec, wfID)
}

// TestWebhookDispatch_SourceMatching proves the matching contract:
// a post whose source exactly matches a listener's config fires that
// listener AND every catch-all (empty source config); a post with no
// matching source fires the catch-alls only; a post carrying no source
// field at all fires the catch-alls only, never a scoped listener.
func TestWebhookDispatch_SourceMatching(t *testing.T) {
	comp, trig, exec, _ := newSystemEventHarness(t)

	scopedID := newWebhookWorkflow(t, comp, "webhook-scoped", "mytool")
	catchAllID := newWebhookWorkflow(t, comp, "webhook-catchall", "")
	otherID := newWebhookWorkflow(t, comp, "webhook-other", "othertool")

	// Exact match: scoped + catch-all fire, other stays quiet.
	trig.DispatchWebhookEvent(map[string]string{"source": "mytool", "title": "hello"}, []byte(`{"source":"mytool","title":"hello"}`))
	if got := awaitRuns(t, exec, scopedID, 1); got != 1 {
		t.Fatalf("scoped workflow: %d runs, want 1 (exact source match)", got)
	}
	if got := awaitRuns(t, exec, catchAllID, 1); got != 1 {
		t.Fatalf("catch-all workflow: %d runs, want 1 (catch-all fires beside the exact match)", got)
	}

	// No matching listener for this source: the catch-all alone fires.
	trig.DispatchWebhookEvent(map[string]string{"source": "unknown"}, []byte(`{"source":"unknown"}`))
	if got := awaitRuns(t, exec, catchAllID, 2); got != 2 {
		t.Fatalf("catch-all workflow: %d runs, want 2 (unmatched source still reaches the catch-all)", got)
	}
	if got := completedRuns(t, exec, otherID); got != 0 {
		t.Fatalf("other-source workflow: %d runs, want 0 (no exact match, never the catch-all bucket twice)", got)
	}

	// No source field at all: only an empty-matcher listener fires.
	trig.DispatchWebhookEvent(map[string]string{"title": "no source here"}, []byte(`{"title":"no source here"}`))
	if got := awaitRuns(t, exec, catchAllID, 3); got != 3 {
		t.Fatalf("catch-all workflow: %d runs, want 3 (a sourceless post fires the catch-all)", got)
	}
	if got := completedRuns(t, exec, scopedID); got != 1 {
		t.Fatalf("scoped workflow: %d runs, want 1 (a sourceless post never fires a scoped listener)", got)
	}

	// A disabled workflow's listener disarms: the next post skips it.
	if _, err := comp.SetWorkflowDisabled(scopedID, true); err != nil {
		t.Fatalf("SetWorkflowDisabled: %v", err)
	}
	trig.DispatchWebhookEvent(map[string]string{"source": "mytool"}, []byte(`{"source":"mytool"}`))
	if got := awaitRuns(t, exec, catchAllID, 4); got != 4 {
		t.Fatalf("catch-all workflow: %d runs, want 4", got)
	}
	if got := completedRuns(t, exec, scopedID); got != 1 {
		t.Fatalf("disabled scoped workflow: %d runs, want 1 (disarm stopped new fires)", got)
	}
}

// TestSeededWebhookNotifyExample_WebhookPost_NotifiesFromPostedFields
// is the goal's own seeded proof: the shipped "Notify when a webhook
// fires" workflow (ENABLED -- its only effect is notifications on the
// user's own channels) arms at boot, and a webhook post carrying
// source/title/body fills the declared Attributes of those names --
// the notification says what the tool posted, not the fixed fallback.
func TestSeededWebhookNotifyExample_WebhookPost_NotifiesFromPostedFields(t *testing.T) {
	comp, trig, exec, _ := newSystemEventHarness(t)

	// apply-notify's seam, wired the way main.go wires the real
	// notifier -- recorded so the assertion proves the notification
	// text itself, not just run success.
	var notified int32
	var gotTitle, gotBody atomic.Value
	composition.SetNotifier(func(title, body, _ string, _ []string) error {
		gotTitle.Store(title)
		gotBody.Store(body)
		atomic.AddInt32(&notified, 1)
		return nil
	})
	t.Cleanup(func() {
		composition.SetNotifier(func(title, body, _ string, _ []string) error { return fmt.Errorf("no notifier registered (yet)") })
	})

	wf := findWorkflowByLabel(t, comp, "Notify when a webhook fires")
	if wf.Disabled {
		t.Fatal("the webhook-notify seed ships ENABLED -- a notification on the user's own channels carries no outbound risk")
	}
	if wf.PublishedVersion == 0 {
		t.Fatal("the webhook-notify seed ships auto-published (migratePublish), same as the update-available seed")
	}
	// main.go's own boot pass arms every enabled workflow's trigger.
	trig.Sync(comp.Workflows())

	raw := []byte(`{"source":"mytool","title":"build done","body":"three tests failed"}`)
	trig.DispatchWebhookEvent(map[string]string{"source": "mytool", "title": "build done", "body": "three tests failed"}, raw)

	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) && atomic.LoadInt32(&notified) == 0 {
		time.Sleep(50 * time.Millisecond)
	}
	if atomic.LoadInt32(&notified) == 0 {
		if runs, err := exec.ListRunsForWorkflow(wf.ID); err == nil {
			for _, run := range runs {
				t.Logf("run %s: kind=%s error=%q", run.RunID, run.Kind, run.Error)
			}
		}
		t.Fatal("the seeded workflow never notified on a matching webhook post")
	}
	if title, _ := gotTitle.Load().(string); title != "build done" {
		t.Errorf("notification title = %q, want the posted titleAttribute's value %q", title, "build done")
	}
	if body, _ := gotBody.Load().(string); body != "three tests failed" {
		t.Errorf("notification body = %q, want the posted bodyAttribute's value %q", body, "three tests failed")
	}
}

// TestSeededWebhookNotifyExample_PostWithoutFields_UsesFallbacks proves
// the seed's own documented shape: a post with no title/body fields
// (say, a timer tool whose payload names nothing the workflow declares)
// still notifies with the fixed fallbacks rather than failing the run.
func TestSeededWebhookNotifyExample_PostWithoutFields_UsesFallbacks(t *testing.T) {
	comp, trig, _, _ := newSystemEventHarness(t)

	var notified int32
	var gotTitle, gotBody atomic.Value
	composition.SetNotifier(func(title, body, _ string, _ []string) error {
		gotTitle.Store(title)
		gotBody.Store(body)
		atomic.AddInt32(&notified, 1)
		return nil
	})
	t.Cleanup(func() {
		composition.SetNotifier(func(title, body, _ string, _ []string) error { return fmt.Errorf("no notifier registered (yet)") })
	})

	wfDisabled := findWorkflowByLabel(t, comp, "Notify when a webhook fires").Disabled
	if wfDisabled {
		t.Fatal("the webhook-notify seed ships ENABLED")
	}
	trig.Sync(comp.Workflows())

	trig.DispatchWebhookEvent(map[string]string{"source": "mytool"}, []byte(`{"source":"mytool"}`))

	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) && atomic.LoadInt32(&notified) == 0 {
		time.Sleep(50 * time.Millisecond)
	}
	if atomic.LoadInt32(&notified) == 0 {
		t.Fatal("the seeded workflow never notified on a post without title/body fields")
	}
	if title, _ := gotTitle.Load().(string); title != "Webhook event" {
		t.Errorf("notification title = %q, want the seed's fixed fallback %q", title, "Webhook event")
	}
	if body, _ := gotBody.Load().(string); body != "A tool posted a webhook event." {
		t.Errorf("notification body = %q, want the seed's fixed fallback", body)
	}
}
