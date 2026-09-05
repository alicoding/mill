package atlassvc

import (
	"testing"

	"github.com/alicoding/mill/internal/domain/atlas"
)

// TestUndo_FirstResize_BoardObject_RestoresUnsizedState regresses
// goal 0273's audit defect: undoing a board object's FIRST-EVER resize
// must restore Size to nil (its natural/auto footprint), never a
// zero Dimensions{} (a 0x0 box). A second resize's undo must return
// the FIRST resize's own size, not unsized.
func TestUndo_FirstResize_BoardObject_RestoresUnsizedState(t *testing.T) {
	a := newTestAtlasService(t)
	o, err := a.CreateBoardObject("shape", nil, atlas.Position{}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}
	if o.Size != nil {
		t.Fatalf("freshly created object's Size = %+v, want nil", o.Size)
	}

	first := atlas.Dimensions{W: 200, H: 150}
	if _, err := a.SetBoardObjectSize(o.ID, first); err != nil {
		t.Fatalf("SetBoardObjectSize (first): %v", err)
	}

	res := a.Undo()
	if !res.Applied || res.Skipped {
		t.Fatalf("Undo() = %+v, want Applied and not Skipped", res)
	}
	found := findBoardObject(t, a, o.ID)
	if found.Size != nil {
		t.Fatalf("Size after undoing the first-ever resize = %+v, want nil (unsized), not a 0x0 box", found.Size)
	}

	res = a.Redo()
	if !res.Applied || res.Skipped {
		t.Fatalf("Redo() = %+v, want Applied and not Skipped", res)
	}
	found = findBoardObject(t, a, o.ID)
	if found.Size == nil || *found.Size != first {
		t.Fatalf("Size after Redo() = %+v, want %+v", found.Size, first)
	}

	second := atlas.Dimensions{W: 300, H: 250}
	if _, err := a.SetBoardObjectSize(o.ID, second); err != nil {
		t.Fatalf("SetBoardObjectSize (second): %v", err)
	}
	res = a.Undo()
	if !res.Applied || res.Skipped {
		t.Fatalf("Undo() after second resize = %+v, want Applied and not Skipped", res)
	}
	found = findBoardObject(t, a, o.ID)
	if found.Size == nil || *found.Size != first {
		t.Fatalf("Size after undoing the second resize = %+v, want the first resize's %+v", found.Size, first)
	}
}

// TestUndo_FirstResize_Note_RestoresUnsizedState is the note door's
// twin of TestUndo_FirstResize_BoardObject_RestoresUnsizedState --
// same shared derefSize(nil) defect, same fix, same door shape
// (SetNoteSize/atlasnote.go).
func TestUndo_FirstResize_Note_RestoresUnsizedState(t *testing.T) {
	a := newTestAtlasService(t)
	n, err := a.CreateNote("resize me", atlas.Position{}, "")
	if err != nil {
		t.Fatalf("CreateNote: %v", err)
	}
	if n.Size != nil {
		t.Fatalf("freshly created note's Size = %+v, want nil", n.Size)
	}

	first := atlas.Dimensions{W: 240, H: 180}
	if _, err := a.SetNoteSize(n.ID, first); err != nil {
		t.Fatalf("SetNoteSize (first): %v", err)
	}

	res := a.Undo()
	if !res.Applied || res.Skipped {
		t.Fatalf("Undo() = %+v, want Applied and not Skipped", res)
	}
	found := findNote(t, a, n.ID)
	if found.Size != nil {
		t.Fatalf("Size after undoing the first-ever resize = %+v, want nil (unsized), not a 0x0 box", found.Size)
	}

	res = a.Redo()
	if !res.Applied || res.Skipped {
		t.Fatalf("Redo() = %+v, want Applied and not Skipped", res)
	}
	found = findNote(t, a, n.ID)
	if found.Size == nil || *found.Size != first {
		t.Fatalf("Size after Redo() = %+v, want %+v", found.Size, first)
	}

	second := atlas.Dimensions{W: 260, H: 220}
	if _, err := a.SetNoteSize(n.ID, second); err != nil {
		t.Fatalf("SetNoteSize (second): %v", err)
	}
	res = a.Undo()
	if !res.Applied || res.Skipped {
		t.Fatalf("Undo() after second resize = %+v, want Applied and not Skipped", res)
	}
	found = findNote(t, a, n.ID)
	if found.Size == nil || *found.Size != first {
		t.Fatalf("Size after undoing the second resize = %+v, want the first resize's %+v", found.Size, first)
	}
}

// TestUndo_FirstResize_RestoresUnsizedState_EveryDoor is goal 0273's
// defect-class regression: SetCardSize now shares recordSizeChange
// with SetNoteSize/SetBoardObjectSize (the two doors
// TestUndo_FirstResize_Note_RestoresUnsizedState/
// TestUndo_FirstResize_BoardObject_RestoresUnsizedState above already
// cover), so undoing an entity's FIRST-EVER resize must restore the
// unsized (nil) state -- never a zero Dimensions{} box -- for every
// sized entity, and a second resize's undo must return the first
// resize's own size rather than unsized.
func TestUndo_FirstResize_RestoresUnsizedState_EveryDoor(t *testing.T) {
	type sizeDoor struct {
		name    string
		create  func(t *testing.T, a *AtlasService) string
		size    func(t *testing.T, a *AtlasService, id string) *atlas.Dimensions
		setSize func(t *testing.T, a *AtlasService, id string, d atlas.Dimensions)
	}

	doors := []sizeDoor{
		{
			name: "card",
			create: func(t *testing.T, a *AtlasService) string {
				t.Helper()
				k := setupUndoKind(t, a)
				c, err := a.CreateCard(k.ID, "resize me", "", nil, "", nil, "", "", "", "")
				if err != nil {
					t.Fatalf("CreateCard: %v", err)
				}
				return c.ID
			},
			size: func(t *testing.T, a *AtlasService, id string) *atlas.Dimensions {
				t.Helper()
				c, ok := findCardTestByID(a.Cards(), id)
				if !ok {
					t.Fatalf("no card with id %q in Cards()", id)
				}
				return c.Size
			},
			setSize: func(t *testing.T, a *AtlasService, id string, d atlas.Dimensions) {
				t.Helper()
				if _, err := a.SetCardSize(id, d.W, d.H); err != nil {
					t.Fatalf("SetCardSize: %v", err)
				}
			},
		},
		{
			name: "note",
			create: func(t *testing.T, a *AtlasService) string {
				t.Helper()
				n, err := a.CreateNote("resize me", atlas.Position{}, "")
				if err != nil {
					t.Fatalf("CreateNote: %v", err)
				}
				return n.ID
			},
			size: func(t *testing.T, a *AtlasService, id string) *atlas.Dimensions {
				t.Helper()
				return findNote(t, a, id).Size
			},
			setSize: func(t *testing.T, a *AtlasService, id string, d atlas.Dimensions) {
				t.Helper()
				if _, err := a.SetNoteSize(id, d); err != nil {
					t.Fatalf("SetNoteSize: %v", err)
				}
			},
		},
		{
			name: "board object",
			create: func(t *testing.T, a *AtlasService) string {
				t.Helper()
				o, err := a.CreateBoardObject("shape", nil, atlas.Position{}, "")
				if err != nil {
					t.Fatalf("CreateBoardObject: %v", err)
				}
				return o.ID
			},
			size: func(t *testing.T, a *AtlasService, id string) *atlas.Dimensions {
				t.Helper()
				return findBoardObject(t, a, id).Size
			},
			setSize: func(t *testing.T, a *AtlasService, id string, d atlas.Dimensions) {
				t.Helper()
				if _, err := a.SetBoardObjectSize(id, d); err != nil {
					t.Fatalf("SetBoardObjectSize: %v", err)
				}
			},
		},
	}

	first := atlas.Dimensions{W: 240, H: 180}
	second := atlas.Dimensions{W: 300, H: 260}

	for _, d := range doors {
		t.Run(d.name, func(t *testing.T) {
			a := newTestAtlasService(t)
			id := d.create(t, a)
			if got := d.size(t, a, id); got != nil {
				t.Fatalf("freshly created %s's Size = %+v, want nil", d.name, got)
			}

			d.setSize(t, a, id, first)
			res := a.Undo()
			if !res.Applied || res.Skipped {
				t.Fatalf("Undo() after first resize = %+v, want Applied and not Skipped", res)
			}
			if got := d.size(t, a, id); got != nil {
				t.Fatalf("%s Size after undoing the first-ever resize = %+v, want nil (unsized), not a 0x0 box", d.name, got)
			}

			res = a.Redo()
			if !res.Applied || res.Skipped {
				t.Fatalf("Redo() = %+v, want Applied and not Skipped", res)
			}
			if got := d.size(t, a, id); got == nil || *got != first {
				t.Fatalf("%s Size after Redo() = %+v, want %+v", d.name, got, first)
			}

			d.setSize(t, a, id, second)
			res = a.Undo()
			if !res.Applied || res.Skipped {
				t.Fatalf("Undo() after second resize = %+v, want Applied and not Skipped", res)
			}
			if got := d.size(t, a, id); got == nil || *got != first {
				t.Fatalf("%s Size after undoing the second resize = %+v, want the first resize's %+v", d.name, got, first)
			}
		})
	}
}

func findBoardObject(t *testing.T, a *AtlasService, id string) atlas.BoardObject {
	t.Helper()
	for _, o := range a.Objects() {
		if o.ID == id {
			return o
		}
	}
	t.Fatalf("no board object with id %q in Objects()", id)
	return atlas.BoardObject{}
}

func findNote(t *testing.T, a *AtlasService, id string) atlas.Note {
	t.Helper()
	for _, n := range a.Notes() {
		if n.ID == id {
			return n
		}
	}
	t.Fatalf("no note with id %q in Notes()", id)
	return atlas.Note{}
}
