package atlassvc

import (
	"reflect"
	"testing"
)

// TestUndoCompleteness_EveryMutationDoorIsClassified is ADR-0044's own
// enforcement (Consequences: "a door that skips it is a review defect,
// not a silent gap"): reflects over every EXPORTED *AtlasService
// method and asserts each one is classified into EXACTLY one of the
// three maintained sets below. A method reflection finds that's in
// NONE of them fails the build -- the forcing function for a future
// mutation door added without a journal decision. A method listed that
// no longer exists (renamed/removed) also fails, so the lists stay
// truthful rather than accumulating stale names.
func TestUndoCompleteness_EveryMutationDoorIsClassified(t *testing.T) {
	typ := reflect.TypeOf(&AtlasService{})
	all := make(map[string]bool, typ.NumMethod())
	for i := 0; i < typ.NumMethod(); i++ {
		all[typ.Method(i).Name] = true
	}

	seen := map[string]string{} // method -> which list it came from
	classify := func(list map[string]string, listName string) {
		for name := range list {
			if !all[name] {
				t.Errorf("%s lists %q, but no such exported AtlasService method exists (stale entry -- fix the list)", listName, name)
				continue
			}
			if other, dup := seen[name]; dup {
				t.Errorf("%q is classified in both %s and %s -- exactly one", name, other, listName)
				continue
			}
			seen[name] = listName
		}
	}
	classify(journaledDoors, "journaledDoors")
	classify(exemptDoors, "exemptDoors")
	classify(notMutationDoors, "notMutationDoors")

	for name := range all {
		if _, ok := seen[name]; !ok {
			t.Errorf("AtlasService.%s is exported and unclassified -- add it to journaledDoors (with a recordUndo call at its seam) or exemptDoors (with a reason) in atlasundo_doors.go", name)
		}
	}
}
