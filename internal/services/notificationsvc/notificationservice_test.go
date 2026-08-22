package notificationsvc

import (
	"errors"
	"testing"

	"github.com/alicoding/mill/internal/domain/notification"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// fakeChannel is a minimal notification.Channel test double: it
// records every Deliver call and lets a test control ShouldDeliver's
// verdict, so Publish's fan-out logic is testable without any real
// OS/browser machinery.
type fakeChannel struct {
	name       string
	deliver    bool
	deliverErr error
	calls      []notification.Event
}

func (c *fakeChannel) Name() string                              { return c.name }
func (c *fakeChannel) ShouldDeliver(notification.Event) bool      { return c.deliver }
func (c *fakeChannel) Deliver(evt notification.Event, _ notification.Record) error {
	c.calls = append(c.calls, evt)
	return c.deliverErr
}

func TestPublish_NewEvent_PersistsAndDelivers(t *testing.T) {
	store := servicetest.NewFakeStore()
	s := New(store)
	ch := &fakeChannel{name: "test-channel", deliver: true}
	s.RegisterChannel(ch)

	result, err := s.Publish(notification.Event{Type: "run-failed", Title: "Workflow failed", Body: "x failed.", DedupeKey: "run-1"})
	if err != nil {
		t.Fatalf("Publish: %v", err)
	}
	if result.Record.ID == "" {
		t.Error("Record.ID is empty, want a minted ID")
	}
	if len(ch.calls) != 1 {
		t.Fatalf("channel Deliver called %d times, want 1", len(ch.calls))
	}
	if len(result.Delivered) != 1 || result.Delivered[0] != "test-channel" {
		t.Errorf("Delivered = %v, want [test-channel]", result.Delivered)
	}
}

// TestPublish_SameDedupeKeyTwice_DeliversEachChannelExactlyOnce pins
// goal 0171's "exactly ONE dedupe mechanism" acceptance: a repeat
// Publish for the same DedupeKey must not re-deliver a channel that
// already fired, even though it resolves to the same durable Record.
func TestPublish_SameDedupeKeyTwice_DeliversEachChannelExactlyOnce(t *testing.T) {
	store := servicetest.NewFakeStore()
	s := New(store)
	ch := &fakeChannel{name: "test-channel", deliver: true}
	s.RegisterChannel(ch)

	evt := notification.Event{Type: "run-failed", Title: "t", Body: "b", DedupeKey: "run-1"}
	first, err := s.Publish(evt)
	if err != nil {
		t.Fatalf("first Publish: %v", err)
	}
	second, err := s.Publish(evt)
	if err != nil {
		t.Fatalf("second Publish: %v", err)
	}
	if first.Record.ID != second.Record.ID {
		t.Errorf("second Publish minted a new record (%s), want the same one (%s)", second.Record.ID, first.Record.ID)
	}
	if len(ch.calls) != 1 {
		t.Errorf("channel Deliver called %d times across two Publish calls, want 1", len(ch.calls))
	}
	if len(second.Delivered) != 0 {
		t.Errorf("second Publish's own Delivered = %v, want none (already delivered)", second.Delivered)
	}
}

// TestPublish_DedupeSurvivesReload proves the per-channel delivery
// record is read back from the store, not held only in memory (goal
// 0171's acceptance: "exactly ONE dedupe mechanism, and it SURVIVES A
// RELOAD" -- unlike the two in-memory Sets it replaces).
func TestPublish_DedupeSurvivesReload(t *testing.T) {
	store := servicetest.NewFakeStore()
	s := New(store)
	ch := &fakeChannel{name: "test-channel", deliver: true}
	s.RegisterChannel(ch)

	evt := notification.Event{Type: "run-failed", Title: "t", Body: "b", DedupeKey: "run-1"}
	if _, err := s.Publish(evt); err != nil {
		t.Fatalf("Publish: %v", err)
	}

	// A fresh instance against the SAME store simulates a restart --
	// no shared Go state survives, only what was persisted.
	reloaded := New(store)
	reloadedCh := &fakeChannel{name: "test-channel", deliver: true}
	reloaded.RegisterChannel(reloadedCh)

	result, err := reloaded.Publish(evt)
	if err != nil {
		t.Fatalf("Publish after reload: %v", err)
	}
	if len(reloadedCh.calls) != 0 {
		t.Errorf("channel Deliver called %d times after reload, want 0 (already delivered before restart)", len(reloadedCh.calls))
	}
	if len(result.Delivered) != 0 {
		t.Errorf("Delivered after reload = %v, want none", result.Delivered)
	}
}

// TestPublish_NoWindowOpen_StillVisibleAfterReload pins the silent-loss
// case (docs/goals/0171's acceptance): a non-approval event published
// with no channel able to deliver it at all (the "no window/tab open"
// case -- every ShouldDeliver returns false) must still be durably
// persisted and readable via ListNotifications, including after a
// fresh load from the same store simulating a restart.
func TestPublish_NoWindowOpen_StillVisibleAfterReload(t *testing.T) {
	store := servicetest.NewFakeStore()
	s := New(store)
	ch := &fakeChannel{name: "desktop-banner", deliver: false} // nothing is open to deliver to
	s.RegisterChannel(ch)

	evt := notification.Event{Type: "run-completed", Title: "Workflow finished", Body: "Nightly sync finished running.", DedupeKey: "run-42"}
	if _, err := s.Publish(evt); err != nil {
		t.Fatalf("Publish: %v", err)
	}
	if len(ch.calls) != 0 {
		t.Fatalf("channel Deliver called with ShouldDeliver=false, want 0 calls")
	}

	reloaded := New(store)
	list := reloaded.ListNotifications()
	if len(list) != 1 {
		t.Fatalf("ListNotifications after reload = %d records, want 1", len(list))
	}
	if list[0].DedupeKey != "run-42" || list[0].Title != "Workflow finished" {
		t.Errorf("ListNotifications()[0] = %+v, want the run-completed record published while no channel was open", list[0])
	}
}

func TestPublish_RejectsEmptyDedupeKey(t *testing.T) {
	s := New(servicetest.NewFakeStore())
	if _, err := s.Publish(notification.Event{Type: "run-failed"}); err == nil {
		t.Error("Publish with empty DedupeKey = nil error, want a validation error")
	}
}

func TestPublish_ChannelDeliverError_DoesNotBlockOtherChannels(t *testing.T) {
	store := servicetest.NewFakeStore()
	s := New(store)
	failing := &fakeChannel{name: "failing", deliver: true, deliverErr: errors.New("simulated delivery failure")}
	ok := &fakeChannel{name: "ok", deliver: true}
	s.RegisterChannel(failing)
	s.RegisterChannel(ok)

	result, err := s.Publish(notification.Event{Type: "run-failed", DedupeKey: "run-1"})
	if err != nil {
		t.Fatalf("Publish: %v", err)
	}
	if len(failing.calls) != 1 || len(ok.calls) != 1 {
		t.Fatalf("expected both channels called once each, got failing=%d ok=%d", len(failing.calls), len(ok.calls))
	}
	if len(result.Delivered) != 1 || result.Delivered[0] != "ok" {
		t.Errorf("Delivered = %v, want [ok] (the failing channel must not be recorded as delivered)", result.Delivered)
	}
}

func TestRegisterChannel_DuplicateName_Panics(t *testing.T) {
	s := New(servicetest.NewFakeStore())
	s.RegisterChannel(&fakeChannel{name: "dup"})
	defer func() {
		if recover() == nil {
			t.Error("RegisterChannel with a duplicate name did not panic")
		}
	}()
	s.RegisterChannel(&fakeChannel{name: "dup"})
}

func TestMarkRead_SetsReadAtOnce(t *testing.T) {
	s := New(servicetest.NewFakeStore())
	result, err := s.Publish(notification.Event{Type: "run-failed", DedupeKey: "run-1"})
	if err != nil {
		t.Fatalf("Publish: %v", err)
	}
	if err := s.MarkRead(result.Record.ID); err != nil {
		t.Fatalf("MarkRead: %v", err)
	}
	list := s.ListNotifications()
	if len(list) != 1 || list[0].ReadAt == nil {
		t.Fatalf("ListNotifications()[0].ReadAt is nil after MarkRead")
	}
	firstReadAt := *list[0].ReadAt
	if err := s.MarkRead(result.Record.ID); err != nil {
		t.Fatalf("second MarkRead: %v", err)
	}
	if got := *s.ListNotifications()[0].ReadAt; !got.Equal(firstReadAt) {
		t.Errorf("second MarkRead changed ReadAt from %v to %v, want idempotent", firstReadAt, got)
	}
}
