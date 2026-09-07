package wiring

import (
	"fmt"
	"sync"
	"testing"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/notification"
	"github.com/alicoding/mill/internal/services/notificationsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// fakeChannel records what the spine hands its Deliver, so an
// assertion proves fan-out without any OS/browser machinery (the same
// reason Channel splits ShouldDeliver from Deliver -- see that
// interface's doc comment).
type fakeChannel struct {
	mu      sync.Mutex
	events  []notification.Event
	records []notification.Record
}

func (f *fakeChannel) Name() string                          { return "fake" }
func (f *fakeChannel) ShouldDeliver(notification.Event) bool { return true }
func (f *fakeChannel) Deliver(evt notification.Event, rec notification.Record) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.events = append(f.events, evt)
	f.records = append(f.records, rec)
	return nil
}

// TestWireNotify_PublishesThroughTheSpine pins the goal 0368 rewire:
// apply-notify's notifier fans out through NotificationService.Publish
// -- a real channel registered on the spine receives the event (title,
// body, Type "workflow-notify", a run-scoped DedupeKey), and the
// record persists -- instead of the old direct-to-OS-banner bypass.
func TestWireNotify_PublishesThroughTheSpine(t *testing.T) {
	notif := notificationsvc.New(servicetest.NewFakeStore())
	channel := &fakeChannel{}
	notif.RegisterChannel(channel)

	WireNotify(notif)
	t.Cleanup(func() {
		composition.SetNotifier(func(title, body, _ string) error {
			return fmt.Errorf("no notifier registered (yet)")
		})
	})

	// The smallest workflow that exercises the notifier: trigger-manual
	// (no listener, no payload) into apply-notify. RunContext stays
	// empty here -- no executionsvc is in the loop -- so the seam's
	// documented degradation applies: SourceRef "", uuid-fallback key.
	if _, err := composition.ExecuteWorkflow(
		[]composition.Node{
			{ID: "trig", NodeTypeID: "trigger-manual", Kind: composition.KindTrigger},
			{ID: "notify", NodeTypeID: "apply-notify", Kind: composition.KindApply,
				Config: map[string]string{"title": "Done", "body": "Ready to paste."}},
		},
		[]composition.Edge{{ID: "e0", Source: "trig", Target: "notify"}},
		nil,
	); err != nil {
		t.Fatalf("ExecuteWorkflow() = %v, want nil error", err)
	}

	channel.mu.Lock()
	defer channel.mu.Unlock()
	if len(channel.events) != 1 {
		t.Fatalf("fan-out delivered %d events, want 1", len(channel.events))
	}
	evt := channel.events[0]
	if evt.Type != "workflow-notify" {
		t.Errorf("event Type = %q, want %q", evt.Type, "workflow-notify")
	}
	if evt.Title != "Done" || evt.Body != "Ready to paste." {
		t.Errorf("event = (%q, %q), want the node's configured title and body", evt.Title, evt.Body)
	}
	if evt.DedupeKey == "" {
		t.Error("event has an empty DedupeKey, want a run-scoped one")
	}
	if len(notif.ListNotifications()) != 1 {
		t.Errorf("ListNotifications() has %d records, want the publish persisted", len(notif.ListNotifications()))
	}
}
