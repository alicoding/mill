package list

import (
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/domain/typedfield"
)

// The converged task record (docs/goals/0300): the tracker's schema
// carries every field the task apps agree on, in this order, with the
// two original columns unchanged so goal 0070's pinned-version proof
// keeps its shape.
func TestBuiltIn_TaskTrackerCarriesTheConvergedTaskFields(t *testing.T) {
	var tracker List
	for _, l := range BuiltIn() {
		if l.ID == ExampleTaskTrackerID {
			tracker = l
		}
	}
	if tracker.ID == "" {
		t.Fatal("the seeded Task tracker is missing")
	}
	want := []string{"task", "status", "description", "due", "scheduled", "start", "priority", "recurrence", "done", "tags"}
	got := make([]string, 0, len(tracker.Columns))
	for _, c := range tracker.Columns {
		got = append(got, c.Key)
	}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("tracker columns = %v, want %v", got, want)
	}
	types := map[string]typedfield.Type{}
	for _, c := range tracker.Columns {
		types[c.Key] = c.Type
	}
	if types["due"] != typedfield.TypeDate || types["done"] != typedfield.TypeBoolean || types["priority"] != typedfield.TypeOptions {
		t.Errorf("column types = %v", types)
	}
	if tracker.Seed.SeedRevision < 3 {
		t.Errorf("SeedRevision = %d, want the bumped revision (3+)", tracker.Seed.SeedRevision)
	}
	if len(tracker.Versions) != 1 || len(tracker.Versions[0].Columns) != 2 {
		t.Errorf("the published v1 must keep its original two columns, got %+v", tracker.Versions)
	}
}
