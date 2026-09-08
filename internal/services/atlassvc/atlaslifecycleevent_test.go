package atlassvc

import (
	"testing"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/domain/reference"
	"github.com/alicoding/mill/internal/services/dataevent"
)

// captureLifecycleEmits mirrors configuresvc's own captureEmits helper
// (configureservice_dataevent_test.go) for the wider LifecycleEvent
// family (docs/goals/0392 S2) -- dataevent.LifecycleTestHook is the
// only way to observe an emitLifecycle call under `go test`, since
// application.Get() is always nil there.
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

// TestCreateBoardObject_Table_EmitsObjectCreatedAndEntityReferenced is
// the create door's own proof (docs/goals/0392 S2 design contract item
// 1/5): a table object, created with its listID already set (the real
// paste/toolbar order -- the List exists before the object does),
// fires object.created once and entity.referenced once, naming the
// object as the reference's own "by".
func TestCreateBoardObject_Table_EmitsObjectCreatedAndEntityReferenced(t *testing.T) {
	a := newTestAtlasService(t)
	got := captureLifecycleEmits(t)

	o, err := a.CreateBoardObject("table", map[string]string{"listID": "list-under-test", "title": "Vendors"}, atlas.Position{}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}

	created, ok := findLifecycleEvent(*got, "object.created")
	if !ok {
		t.Fatalf("object.created was not emitted; got %+v", *got)
	}
	if created.ObjectID != o.ID || created.Kind != "table" || created.EntityRef != "list" {
		t.Errorf("object.created = %+v, want ObjectID %q, Kind \"table\", EntityRef \"list\"", created, o.ID)
	}

	referenced, ok := findLifecycleEvent(*got, "entity.referenced")
	if !ok {
		t.Fatalf("entity.referenced was not emitted; got %+v", *got)
	}
	if referenced.EntityKind != "list" || referenced.EntityID != "list-under-test" {
		t.Errorf("entity.referenced = %+v, want EntityKind \"list\", EntityID \"list-under-test\"", referenced)
	}
	if referenced.By == nil || referenced.By.ObjectID != o.ID || referenced.By.BoardID != o.ParentID {
		t.Errorf("entity.referenced.By = %+v, want ObjectID %q, BoardID %q", referenced.By, o.ID, o.ParentID)
	}
}

// TestCreateBoardObject_NonEntityKind_EmitsObjectCreatedOnly proves a
// kind with no declared entityRef (image) fires object.created with an
// empty EntityRef and never fires entity.referenced at all.
func TestCreateBoardObject_NonEntityKind_EmitsObjectCreatedOnly(t *testing.T) {
	a := newTestAtlasService(t)
	got := captureLifecycleEmits(t)

	if _, err := a.CreateBoardObject("image", map[string]string{"mirrorPath": "/tmp/shot.png"}, atlas.Position{}, ""); err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}

	created, ok := findLifecycleEvent(*got, "object.created")
	if !ok {
		t.Fatalf("object.created was not emitted; got %+v", *got)
	}
	if created.EntityRef != "" {
		t.Errorf("object.created.EntityRef = %q for an image object, want empty", created.EntityRef)
	}
	if _, ok := findLifecycleEvent(*got, "entity.referenced"); ok {
		t.Error("entity.referenced was emitted for an image object, want none")
	}
}

// TestDeleteBoardObject_SoleReference_EmitsObjectDeletedAndDereferencedZero
// is the delete door's own proof: deleting a table that was the ONLY
// reference to its List fires object.deleted and entity.dereferenced
// with remaining: 0 -- the seeded workflow's own trigger condition.
func TestDeleteBoardObject_SoleReference_EmitsObjectDeletedAndDereferencedZero(t *testing.T) {
	a := newTestAtlasService(t)
	a.WireEntityReferenceIndex(func(entityKind, id string) reference.Refs {
		return reference.Refs{Boards: a.ObjectsReferencing(entityKind, id)}
	})
	o, err := a.CreateBoardObject("table", map[string]string{"listID": "list-under-test"}, atlas.Position{}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}

	got := captureLifecycleEmits(t)
	if _, err := a.DeleteBoardObject(o.ID); err != nil {
		t.Fatalf("DeleteBoardObject: %v", err)
	}

	deleted, ok := findLifecycleEvent(*got, "object.deleted")
	if !ok {
		t.Fatalf("object.deleted was not emitted; got %+v", *got)
	}
	if deleted.ObjectID != o.ID {
		t.Errorf("object.deleted.ObjectID = %q, want %q", deleted.ObjectID, o.ID)
	}

	dereferenced, ok := findLifecycleEvent(*got, "entity.dereferenced")
	if !ok {
		t.Fatalf("entity.dereferenced was not emitted; got %+v", *got)
	}
	if dereferenced.Remaining == nil || *dereferenced.Remaining != 0 {
		t.Errorf("entity.dereferenced.Remaining = %v, want a pointer to 0 (the sole reference was just removed)", dereferenced.Remaining)
	}
}

// TestDeleteBoardObject_OtherReferenceSurvives_ReportsRemainingCount
// proves remaining counts the reference index's own live total, not
// just 0-or-not: a workflow reference surviving the board delete
// reports remaining: 1.
func TestDeleteBoardObject_OtherReferenceSurvives_ReportsRemainingCount(t *testing.T) {
	a := newTestAtlasService(t)
	a.WireEntityReferenceIndex(func(entityKind, id string) reference.Refs {
		return reference.Refs{Workflows: []string{"Some workflow"}}
	})
	o, err := a.CreateBoardObject("table", map[string]string{"listID": "list-under-test"}, atlas.Position{}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}

	got := captureLifecycleEmits(t)
	if _, err := a.DeleteBoardObject(o.ID); err != nil {
		t.Fatalf("DeleteBoardObject: %v", err)
	}

	dereferenced, ok := findLifecycleEvent(*got, "entity.dereferenced")
	if !ok {
		t.Fatalf("entity.dereferenced was not emitted; got %+v", *got)
	}
	if dereferenced.Remaining == nil || *dereferenced.Remaining != 1 {
		t.Errorf("entity.dereferenced.Remaining = %v, want a pointer to 1 (one surviving workflow reference)", dereferenced.Remaining)
	}
}

// TestDeleteBoardObject_NonEntityKind_EmitsObjectDeletedOnly proves a
// kind with no entityRef (ink) fires object.deleted and never
// entity.dereferenced.
func TestDeleteBoardObject_NonEntityKind_EmitsObjectDeletedOnly(t *testing.T) {
	a := newTestAtlasService(t)
	o, err := a.CreateBoardObject("ink", nil, atlas.Position{}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}

	got := captureLifecycleEmits(t)
	if _, err := a.DeleteBoardObject(o.ID); err != nil {
		t.Fatalf("DeleteBoardObject: %v", err)
	}

	if _, ok := findLifecycleEvent(*got, "object.deleted"); !ok {
		t.Fatalf("object.deleted was not emitted; got %+v", *got)
	}
	if _, ok := findLifecycleEvent(*got, "entity.dereferenced"); ok {
		t.Error("entity.dereferenced was emitted for an ink object, want none")
	}
}
