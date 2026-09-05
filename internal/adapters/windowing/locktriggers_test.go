package windowing

import (
	"sync"
	"testing"
)

// TestWireLockTriggers_DeliversToTheSubscriber pins the port's own
// contract, headless: a registered subscriber receives every trigger
// value, and the last registration is the one that receives them.
func TestWireLockTriggers_DeliversToTheSubscriber(t *testing.T) {
	t.Cleanup(func() {
		lockTriggerMu.Lock()
		lockTriggerFn = nil
		lockTriggerMu.Unlock()
	})

	var mu sync.Mutex
	var got []LockTrigger
	// No live application exists under `go test`, so this subscribes no
	// OS source -- it only registers the subscriber, which is exactly
	// what a synthetic trigger needs.
	WrapWindow(nil).WireLockTriggers(func(trigger LockTrigger) {
		mu.Lock()
		defer mu.Unlock()
		got = append(got, trigger)
	})

	want := []LockTrigger{LockTriggerSleep, LockTriggerScreenLock, LockTriggerUserSwitch, LockTriggerMinimize}
	for _, trigger := range want {
		emitLockTrigger(trigger)
	}

	mu.Lock()
	defer mu.Unlock()
	if len(got) != len(want) {
		t.Fatalf("received %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("received %v, want %v", got, want)
		}
	}
}

// TestEmitLockTrigger_NoSubscriberIsSilent pins the no-op path: an OS
// notification arriving before (or after) anything subscribes must not
// panic on a nil callback.
func TestEmitLockTrigger_NoSubscriberIsSilent(t *testing.T) {
	lockTriggerMu.Lock()
	prev := lockTriggerFn
	lockTriggerFn = nil
	lockTriggerMu.Unlock()
	t.Cleanup(func() {
		lockTriggerMu.Lock()
		lockTriggerFn = prev
		lockTriggerMu.Unlock()
	})
	emitLockTrigger(LockTriggerSleep)
}
