package windowing

import (
	"testing"
	"time"
)

// With no live app there is nobody to answer: the wait reports
// ok=false at once rather than sitting out the timeout.
func TestWaitForAnyEvent_NoAppAnswersImmediately(t *testing.T) {
	started := time.Now()
	name, data, ok := WaitForAnyEvent(5*time.Second, "mill-flushed", "mill-quit-held")
	if ok || name != "" || data != nil {
		t.Errorf("WaitForAnyEvent(no app) = %q, %v, %v; want \"\", nil, false", name, data, ok)
	}
	if time.Since(started) > time.Second {
		t.Error("WaitForAnyEvent(no app) waited instead of returning")
	}
}
