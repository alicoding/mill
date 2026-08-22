package settingssvc

import (
	"sync/atomic"
	"testing"
)

// TestSummonKeydownLoop_CallsToggleOncePerEvent proves the hotkey
// callback path itself: a fake keydown fired on the events channel
// bindSummon hands to summonKeydownLoop must reach toggle exactly once.
// The main-thread marshal toggle's own App-level calls need now lives
// inside internal/adapters/windowing (runMainThreadAction), not as an
// outer seam this loop has to carry -- see summonKeydownLoop's own doc
// comment.
func TestSummonKeydownLoop_CallsToggleOncePerEvent(t *testing.T) {
	var toggleCalls int32
	toggle := func() { atomic.AddInt32(&toggleCalls, 1) }

	events := make(chan struct{})
	done := make(chan struct{})
	go func() {
		summonKeydownLoop(events, toggle)
		close(done)
	}()

	events <- struct{}{} // fake keydown
	close(events)
	<-done

	if got := atomic.LoadInt32(&toggleCalls); got != 1 {
		t.Errorf("toggle invoked %d times, want 1", got)
	}
}
