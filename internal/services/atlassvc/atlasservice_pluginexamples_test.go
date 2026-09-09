package atlassvc

import (
	"testing"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/services/servicetest"
)

func exampleFixture() PluginCanvasObjectExample {
	return PluginCanvasObjectExample{
		Kind: "mindmap", Title: "Mind map example", Revision: 1,
		Payload:  map[string]string{},
		Fixtures: []PluginCanvasObjectExampleFixture{{Kind: "note", Body: "# Mind map example\n## Idea", PayloadKey: "noteId"}},
	}
}

// mindmapObjects/fixtureNotes filter NewAtlasService's own construction-
// time reconcileBuiltIns() goldens (shape/table, whichever the fake
// store's captures-dir-less setup materializes) out of the count --
// this test cares only about what ReconcilePluginCanvasObjectExamples
// itself did.
func mindmapObjects(a *AtlasService) []atlas.BoardObject {
	var out []atlas.BoardObject
	for _, o := range a.Objects() {
		if o.Kind == "mindmap" {
			out = append(out, o)
		}
	}
	return out
}

func fixtureNotes(a *AtlasService) []atlas.Note {
	var out []atlas.Note
	for _, n := range a.Notes() {
		if n.ParentID == atlas.BoardGalleryCardID {
			out = append(out, n)
		}
	}
	return out
}

// A fresh reconcile seeds one fixture note and one board object, the
// note's created id landing at the fixture's own PayloadKey and the
// object's title coming from the example's own Title -- the exact
// shape the (not-yet-built) insert-time door is meant to produce too.
func TestReconcilePluginCanvasObjectExamples_SeedsNoteAndObject(t *testing.T) {
	a := NewAtlasService(servicetest.NewFakeStore())
	a.ReconcilePluginCanvasObjectExamples([]PluginCanvasObjectExample{exampleFixture()})

	notes := fixtureNotes(a)
	if len(notes) != 1 {
		t.Fatalf("got %d fixture notes, want 1", len(notes))
	}
	if notes[0].Text != "# Mind map example\n## Idea" {
		t.Errorf("note text = %q, want the fixture's body", notes[0].Text)
	}

	objects := mindmapObjects(a)
	if len(objects) != 1 {
		t.Fatalf("got %d mindmap objects, want 1", len(objects))
	}
	obj := objects[0]
	if obj.Payload["title"] != "Mind map example" {
		t.Errorf("object payload title = %q, want the example's own Title", obj.Payload["title"])
	}
	if obj.Payload["noteId"] != notes[0].ID {
		t.Errorf("object payload noteId = %q, want the created note's own id %q", obj.Payload["noteId"], notes[0].ID)
	}
}

// A second reconcile pass (the every-boot shape) never duplicates the
// note or the object -- the same insert-once idempotency every other
// reconcile in this package already holds.
func TestReconcilePluginCanvasObjectExamples_SecondPassIsIdempotent(t *testing.T) {
	a := NewAtlasService(servicetest.NewFakeStore())
	ex := exampleFixture()
	a.ReconcilePluginCanvasObjectExamples([]PluginCanvasObjectExample{ex})
	a.ReconcilePluginCanvasObjectExamples([]PluginCanvasObjectExample{ex})

	if len(fixtureNotes(a)) != 1 {
		t.Errorf("got %d fixture notes after a second pass, want 1", len(fixtureNotes(a)))
	}
	if len(mindmapObjects(a)) != 1 {
		t.Errorf("got %d mindmap objects after a second pass, want 1", len(mindmapObjects(a)))
	}
}

// A revision bump upgrades the object's own Payload in place (the same
// upgrade path reconcileObjectsLocked runs for built-ins) -- but never
// touches the fixture note, which carries no upgrade path by design
// (this file's own header comment).
func TestReconcilePluginCanvasObjectExamples_RevisionBumpUpgradesObjectOnly(t *testing.T) {
	a := NewAtlasService(servicetest.NewFakeStore())
	ex := exampleFixture()
	a.ReconcilePluginCanvasObjectExamples([]PluginCanvasObjectExample{ex})
	firstNoteID := fixtureNotes(a)[0].ID

	bumped := ex
	bumped.Revision = 2
	bumped.Title = "Mind map example, revised"
	bumped.Fixtures = []PluginCanvasObjectExampleFixture{{Kind: "note", Body: "# A different body entirely", PayloadKey: "noteId"}}
	a.ReconcilePluginCanvasObjectExamples([]PluginCanvasObjectExample{bumped})

	notes := fixtureNotes(a)
	if len(notes) != 1 {
		t.Fatalf("got %d fixture notes after a revision bump, want still 1 (no note upgrade path)", len(notes))
	}
	if notes[0].ID != firstNoteID || notes[0].Text != "# Mind map example\n## Idea" {
		t.Errorf("the fixture note changed on a revision bump, want it left exactly as first seeded")
	}

	objects := mindmapObjects(a)
	if len(objects) != 1 {
		t.Fatalf("got %d mindmap objects after a revision bump, want 1", len(objects))
	}
	if objects[0].Payload["title"] != "Mind map example, revised" {
		t.Errorf("object title after revision bump = %q, want the bumped example's own Title", objects[0].Payload["title"])
	}
	if objects[0].Payload["noteId"] != firstNoteID {
		t.Errorf("object noteId after revision bump = %q, want it still pointing at the original fixture note %q", objects[0].Payload["noteId"], firstNoteID)
	}
}

// A user-modified object is never overwritten by a later revision bump
// -- the same "Modified latches" contract every other seed-origin
// golden in this package holds.
func TestReconcilePluginCanvasObjectExamples_ModifiedObjectNeverOverwritten(t *testing.T) {
	a := NewAtlasService(servicetest.NewFakeStore())
	ex := exampleFixture()
	a.ReconcilePluginCanvasObjectExamples([]PluginCanvasObjectExample{ex})

	a.mu.Lock()
	for i, o := range a.objects {
		if o.Kind == "mindmap" {
			o.Seed.Modified = true
			o.Payload = copyPayload(o.Payload)
			o.Payload["title"] = "User's own title"
			a.objects[i] = o
		}
	}
	a.mu.Unlock()

	bumped := ex
	bumped.Revision = 2
	bumped.Title = "Mind map example, revised"
	a.ReconcilePluginCanvasObjectExamples([]PluginCanvasObjectExample{bumped})

	if mindmapObjects(a)[0].Payload["title"] != "User's own title" {
		t.Errorf("a user-modified object's title changed on reconcile, want it left untouched")
	}
}
