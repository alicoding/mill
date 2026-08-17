package atlassvc

import (
	"testing"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/domain/typedfield"
)

// --- Notes (goal 0081 slice A1) ---

func TestCreateNote_RoundTrips(t *testing.T) {
	a := newTestAtlasService(t)
	n, err := a.CreateNote("a quick thought", atlas.Position{X: 10, Y: 20}, "")
	if err != nil {
		t.Fatalf("CreateNote: %v", err)
	}
	found := false
	for _, got := range a.Notes() {
		if got.ID == n.ID {
			found = true
			if got.Text != "a quick thought" {
				t.Errorf("Notes()'s round-tripped Text = %q, want %q", got.Text, "a quick thought")
			}
		}
	}
	if !found {
		t.Error("CreateNote's note is not present in Notes()")
	}
}

func TestCreateNote_UnknownParent_Errors(t *testing.T) {
	a := newTestAtlasService(t)
	if _, err := a.CreateNote("x", atlas.Position{}, "does-not-exist"); err == nil {
		t.Error("CreateNote() with an unknown parentID = nil error, want an error")
	}
}

func TestCreateNote_BlankText_Errors(t *testing.T) {
	a := newTestAtlasService(t)
	if _, err := a.CreateNote("   ", atlas.Position{}, ""); err == nil {
		t.Error("CreateNote() with blank text = nil error, want an error")
	}
}

func TestUpdateNoteText_RoundTrips(t *testing.T) {
	a := newTestAtlasService(t)
	n, err := a.CreateNote("first draft", atlas.Position{}, "")
	if err != nil {
		t.Fatalf("CreateNote: %v", err)
	}
	updated, err := a.UpdateNoteText(n.ID, "revised")
	if err != nil {
		t.Fatalf("UpdateNoteText: %v", err)
	}
	if updated.Text != "revised" {
		t.Errorf("UpdateNoteText's Text = %q, want %q", updated.Text, "revised")
	}
}

func TestSetNotePosition_RoundTrips(t *testing.T) {
	a := newTestAtlasService(t)
	n, err := a.CreateNote("x", atlas.Position{X: 1, Y: 1}, "")
	if err != nil {
		t.Fatalf("CreateNote: %v", err)
	}
	moved, err := a.SetNotePosition(n.ID, atlas.Position{X: 99, Y: 42})
	if err != nil {
		t.Fatalf("SetNotePosition: %v", err)
	}
	if moved.Position.X != 99 || moved.Position.Y != 42 {
		t.Errorf("SetNotePosition's Position = %+v, want {99 42}", moved.Position)
	}
}

func TestDeleteNote_RemovesIt(t *testing.T) {
	a := newTestAtlasService(t)
	n, err := a.CreateNote("gone soon", atlas.Position{}, "")
	if err != nil {
		t.Fatalf("CreateNote: %v", err)
	}
	if err := a.DeleteNote(n.ID); err != nil {
		t.Fatalf("DeleteNote: %v", err)
	}
	for _, got := range a.Notes() {
		if got.ID == n.ID {
			t.Error("DeleteNote left the note present in Notes()")
		}
	}
}

func TestDeleteNote_UnknownID_Errors(t *testing.T) {
	a := newTestAtlasService(t)
	if err := a.DeleteNote("does-not-exist"); err == nil {
		t.Error("DeleteNote() on an unknown id = nil error, want an error")
	}
}

// --- Promotion (the atomicity + field-mapping the goal's own item 1 calls for) ---

func TestPromoteNote_BadKind_LeavesNoteUntouched(t *testing.T) {
	a := newTestAtlasService(t)
	n, err := a.CreateNote("promote me", atlas.Position{X: 5, Y: 7}, "")
	if err != nil {
		t.Fatalf("CreateNote: %v", err)
	}
	if _, err := a.PromoteNote(n.ID, "does-not-exist", "Title"); err == nil {
		t.Fatal("PromoteNote() with an unknown kindID = nil error, want an error")
	}
	found := false
	for _, got := range a.Notes() {
		if got.ID == n.ID {
			found = true
		}
	}
	if !found {
		t.Error("PromoteNote's failure removed the note -- it must survive a bad-kind promotion untouched")
	}
	for _, c := range a.Cards() {
		if c.Note == "promote me" {
			t.Error("PromoteNote's failure still created a card")
		}
	}
}

func TestPromoteNote_FieldMappingAndAtomicity(t *testing.T) {
	a := newTestAtlasService(t)
	kind, err := a.CreateKind("Widget", "", "", []typedfield.Field{})
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	n, err := a.CreateNote("original note text", atlas.Position{X: 12, Y: 34}, "")
	if err != nil {
		t.Fatalf("CreateNote: %v", err)
	}

	card, err := a.PromoteNote(n.ID, kind.ID, "Promoted Title")
	if err != nil {
		t.Fatalf("PromoteNote: %v", err)
	}
	if card.KindID != kind.ID {
		t.Errorf("PromoteNote's card KindID = %q, want %q", card.KindID, kind.ID)
	}
	if card.Title != "Promoted Title" {
		t.Errorf("PromoteNote's card Title = %q, want %q", card.Title, "Promoted Title")
	}
	if card.Note != "original note text" {
		t.Errorf("PromoteNote's card Note = %q, want the note's own text %q", card.Note, "original note text")
	}
	if card.Position == nil || card.Position.X != 12 || card.Position.Y != 34 {
		t.Errorf("PromoteNote's card Position = %+v, want the note's own position {12 34}", card.Position)
	}

	for _, got := range a.Notes() {
		if got.ID == n.ID {
			t.Error("PromoteNote left the original note present -- promotion must remove it")
		}
	}
	found := false
	for _, c := range a.Cards() {
		if c.ID == card.ID {
			found = true
		}
	}
	if !found {
		t.Error("PromoteNote's card is not present in Cards()")
	}
}
