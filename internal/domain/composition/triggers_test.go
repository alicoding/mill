package composition

import "testing"

// TestTriggerSystemEvent_EventOptions_ListsTheLifecycleFamily is docs/
// goals/0392 S2's own registry proof: trigger-system-event's "event"
// ConfigField Options carries all six entity/object lifecycle events
// (Decision 4) alongside the four run/decision system events and
// update-available it already had -- the one shared NodeType every
// workflow author picks from, never a second trigger schema per event
// family.
func TestTriggerSystemEvent_EventOptions_ListsTheLifecycleFamily(t *testing.T) {
	nt, ok := nodeType("trigger-system-event")
	if !ok {
		t.Fatal(`nodeType("trigger-system-event") not found`)
	}
	var options []string
	for _, f := range nt.ConfigFields {
		if f.Key == "event" {
			options = f.Options
		}
	}
	if options == nil {
		t.Fatal(`trigger-system-event has no "event" ConfigField`)
	}
	want := []string{
		"entity.created", "entity.referenced", "entity.dereferenced", "entity.deleted",
		"object.created", "object.deleted",
	}
	have := make(map[string]bool, len(options))
	for _, o := range options {
		have[o] = true
	}
	for _, w := range want {
		if !have[w] {
			t.Errorf("trigger-system-event's event Options is missing %q, got %v", w, options)
		}
	}
	// The pre-existing four system events must still be there too --
	// this goal's addition is additive, never a replacement.
	for _, w := range []string{"decision-parked", "run-completed", "run-failed", "run-cancelled", "update-available"} {
		if !have[w] {
			t.Errorf("trigger-system-event's event Options lost the pre-existing %q, got %v", w, options)
		}
	}
}
