package triggersvc

import (
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/dataevent"
)

// TestSeededTidyUnusedListsExample_EntityDereferenced_RunsToCompletion
// is docs/goals/0392 S2's own proof: the seeded "Example: tidy unused
// lists" workflow (enabled by default -- a local banner carries no
// outbound risk) fires on entity.dereferenced when a List's last
// reference is removed (remaining: 0) and its apply-notify step
// completes through the real engine.
func TestSeededTidyUnusedListsExample_EntityDereferenced_RunsToCompletion(t *testing.T) {
	comp, trig, exec, _ := newSystemEventHarness(t)

	var notified int32
	composition.SetNotifier(func(title, body, _ string, _ []string) error {
		atomic.AddInt32(&notified, 1)
		return nil
	})
	t.Cleanup(func() {
		composition.SetNotifier(func(title, body, _ string, _ []string) error { return fmt.Errorf("no notifier registered (yet)") })
	})

	tidy := findWorkflowByLabel(t, comp, "Example: tidy unused lists")
	if tidy.Disabled {
		t.Fatal("the tidy-unused-lists seed ships ENABLED -- a local banner carries no outbound risk")
	}
	if _, err := comp.PublishWorkflow(tidy.ID); err != nil {
		t.Fatalf("PublishWorkflow: %v", err)
	}
	trig.Sync(comp.Workflows())

	remaining := 0
	trig.DispatchLifecycleEvent(dataevent.LifecycleEvent{
		Event: "entity.dereferenced", EntityKind: "list", EntityID: "list-under-test",
		By: &dataevent.LifecycleBy{BoardID: "board-1", ObjectID: "object-1"}, Remaining: &remaining,
	})

	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		runs, err := exec.ListRunsForWorkflow(tidy.ID)
		if err == nil {
			for _, r := range runs {
				if r.Status == "SUCCESS" && atomic.LoadInt32(&notified) > 0 {
					return
				}
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatal("the tidy-unused-lists workflow never completed a run notifying for a fully-dereferenced list")
}

// TestSeededTidyUnusedListsExample_StillReferenced_SkipsNotify proves
// the Branch's own filter: a dereference that still leaves other
// references (remaining > 0) completes the run WITHOUT calling the
// notifier -- the "still referenced elsewhere" leaf, not "unused."
func TestSeededTidyUnusedListsExample_StillReferenced_SkipsNotify(t *testing.T) {
	comp, trig, exec, _ := newSystemEventHarness(t)

	var notified int32
	composition.SetNotifier(func(title, body, _ string, _ []string) error {
		atomic.AddInt32(&notified, 1)
		return nil
	})
	t.Cleanup(func() {
		composition.SetNotifier(func(title, body, _ string, _ []string) error { return fmt.Errorf("no notifier registered (yet)") })
	})

	tidy := findWorkflowByLabel(t, comp, "Example: tidy unused lists")
	if _, err := comp.PublishWorkflow(tidy.ID); err != nil {
		t.Fatalf("PublishWorkflow: %v", err)
	}
	trig.Sync(comp.Workflows())

	remaining := 1
	trig.DispatchLifecycleEvent(dataevent.LifecycleEvent{
		Event: "entity.dereferenced", EntityKind: "list", EntityID: "list-under-test",
		By: &dataevent.LifecycleBy{BoardID: "board-1", ObjectID: "object-1"}, Remaining: &remaining,
	})

	deadline := time.Now().Add(10 * time.Second)
	var sawSuccess bool
	for time.Now().Before(deadline) && !sawSuccess {
		runs, err := exec.ListRunsForWorkflow(tidy.ID)
		if err == nil {
			for _, r := range runs {
				if r.Status == "SUCCESS" {
					sawSuccess = true
				}
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
	if !sawSuccess {
		t.Fatal("the tidy-unused-lists workflow never completed a run for a still-referenced dereference")
	}
	if atomic.LoadInt32(&notified) != 0 {
		t.Errorf("notifier called %d times for a still-referenced dereference, want 0 (the Branch should route to the otherwise leaf)", notified)
	}
}
