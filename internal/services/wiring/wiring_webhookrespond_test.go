package wiring

import (
	"runtime"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/services/triggersvc"
)

func TestRelayWebhookWait_NilWait_ReturnsNil(t *testing.T) {
	if got := relayWebhookWait(nil); got != nil {
		t.Fatalf("relayWebhookWait(nil) = %+v, want nil", got)
	}
}

func TestRelayWebhookWait_DeliversTheFirstReply(t *testing.T) {
	src := make(chan triggersvc.WebhookReply, 1)
	src <- triggersvc.WebhookReply{Status: 201, ContentType: "text/plain", Body: "hi"}
	relayed := relayWebhookWait(&triggersvc.WebhookWait{Reply: src, Budget: 5 * time.Second})

	select {
	case r := <-relayed.Reply:
		if r.Status != 201 || r.ContentType != "text/plain" || r.Body != "hi" {
			t.Errorf("relayed reply = %+v, want {201 text/plain hi}", r)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("relay never delivered the reply")
	}
}

// TestRelayWebhookWait_NeverRepliedGoroutineExitsAtBudget is the
// regression for a real goroutine leak found in review: a run left
// permanently parked (goal 0373 design contract item 5) never sends
// anything on triggersvc's own WebhookWait.Reply, and the relay
// goroutine must give up at the SAME budget rather than block forever
// -- proven here by spawning many such relays with a short budget and
// none ever completing, then confirming the live goroutine count
// settles back down once every one of their budgets has elapsed.
func TestRelayWebhookWait_NeverRepliedGoroutineExitsAtBudget(t *testing.T) {
	baseline := runtime.NumGoroutine()

	const n = 50
	const budget = 20 * time.Millisecond
	for range n {
		// Never sent to -- the "permanently parked, nobody ever
		// answers" case this regression covers.
		src := make(chan triggersvc.WebhookReply)
		relayWebhookWait(&triggersvc.WebhookWait{Reply: src, Budget: budget})
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		// A few goroutines of slack for the Go runtime's own background
		// work (GC, timers) -- the bug this pins is unbounded growth
		// proportional to n, not an exact count.
		if runtime.NumGoroutine() <= baseline+5 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("goroutine count stayed at %d (baseline %d) well after every relay's %v budget elapsed -- the relay goroutine leaked", runtime.NumGoroutine(), baseline, budget)
}
