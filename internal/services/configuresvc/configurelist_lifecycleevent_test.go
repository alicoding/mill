package configuresvc

import (
	"testing"

	"github.com/alicoding/mill/internal/services/dataevent"
)

// captureLifecycleEmits mirrors this package's own captureEmits helper
// (configureservice_dataevent_test.go) for the wider LifecycleEvent
// family (docs/goals/0392 S2).
func captureLifecycleEmits(t *testing.T) *[]dataevent.LifecycleEvent {
	t.Helper()
	var got []dataevent.LifecycleEvent
	dataevent.LifecycleTestHook = func(ev dataevent.LifecycleEvent) { got = append(got, ev) }
	t.Cleanup(func() { dataevent.LifecycleTestHook = nil })
	return &got
}

func findLifecycleEvent(events []dataevent.LifecycleEvent, name string) (dataevent.LifecycleEvent, bool) {
	for _, ev := range events {
		if ev.Event == name {
			return ev, true
		}
	}
	return dataevent.LifecycleEvent{}, false
}

// TestCreateList_EmitsEntityCreated is the entity door's own proof
// (docs/goals/0392 S2): a List creation fires entity.created naming
// its own id and the "list" entityKind, the same refKind vocabulary
// refIntegrityError already uses.
func TestCreateList_EmitsEntityCreated(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	got := captureLifecycleEmits(t)

	l, err := cfg.CreateList("Lifecycle test list", "", nil)
	if err != nil {
		t.Fatalf("CreateList: %v", err)
	}

	ev, ok := findLifecycleEvent(*got, "entity.created")
	if !ok {
		t.Fatalf("entity.created was not emitted; got %+v", *got)
	}
	if ev.EntityKind != "list" || ev.EntityID != l.ID {
		t.Errorf("entity.created = %+v, want EntityKind \"list\", EntityID %q", ev, l.ID)
	}
}

// TestDeleteList_EmitsEntityDeleted proves the reverse: deleting an
// unreferenced List fires entity.deleted with the same identity.
func TestDeleteList_EmitsEntityDeleted(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	l, err := cfg.CreateList("Lifecycle delete test", "", nil)
	if err != nil {
		t.Fatalf("CreateList: %v", err)
	}

	got := captureLifecycleEmits(t)
	if err := cfg.DeleteList(l.ID); err != nil {
		t.Fatalf("DeleteList: %v", err)
	}

	ev, ok := findLifecycleEvent(*got, "entity.deleted")
	if !ok {
		t.Fatalf("entity.deleted was not emitted; got %+v", *got)
	}
	if ev.EntityKind != "list" || ev.EntityID != l.ID {
		t.Errorf("entity.deleted = %+v, want EntityKind \"list\", EntityID %q", ev, l.ID)
	}
}

// TestUndoListDelete_DoesNotEmitEntityDeleted proves the ⌘Z restore
// path -- which reuses the SAME announce closure DeleteList's own
// dataevent.Emit("list", id) rides -- never fires entity.deleted a
// second time: DeleteList calls EmitEntityDeleted directly, once, on
// its own success, never from inside announce.
func TestUndoListDelete_DoesNotEmitEntityDeleted(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	l, err := cfg.CreateList("Lifecycle undo test", "", nil)
	if err != nil {
		t.Fatalf("CreateList: %v", err)
	}
	if err := cfg.DeleteList(l.ID); err != nil {
		t.Fatalf("DeleteList: %v", err)
	}

	got := captureLifecycleEmits(t)
	if err := cfg.UndoDelete("list", l.ID); err != nil {
		t.Fatalf("UndoDelete: %v", err)
	}

	if ev, ok := findLifecycleEvent(*got, "entity.deleted"); ok {
		t.Errorf("entity.deleted was emitted on undo/restore: %+v, want none", ev)
	}
}
