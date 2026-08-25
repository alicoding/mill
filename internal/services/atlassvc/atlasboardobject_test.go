package atlassvc

import (
	"testing"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/domain/typedfield"
)

// --- Board objects (goal 0179/0180) ---

func TestCreateBoardObject_RoundTrips(t *testing.T) {
	a := newTestAtlasService(t)
	o, err := a.CreateBoardObject("image", map[string]string{"mirrorPath": "/tmp/shot.png"}, atlas.Position{X: 10, Y: 20}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}
	found := false
	for _, got := range a.Objects() {
		if got.ID == o.ID {
			found = true
			if got.Kind != "image" {
				t.Errorf("Objects()'s round-tripped Kind = %q, want %q", got.Kind, "image")
			}
			if got.Payload["mirrorPath"] != "/tmp/shot.png" {
				t.Errorf("Objects()'s round-tripped Payload[mirrorPath] = %q, want %q", got.Payload["mirrorPath"], "/tmp/shot.png")
			}
		}
	}
	if !found {
		t.Error("CreateBoardObject's object is not present in Objects()")
	}
}

// Regression: a caller's own payload map must not alias stored state --
// mutating it after the call returns must never reach what was persisted.
func TestCreateBoardObject_CopiesPayload(t *testing.T) {
	a := newTestAtlasService(t)
	payload := map[string]string{"mirrorPath": "/tmp/a.svg"}
	o, err := a.CreateBoardObject("ink", payload, atlas.Position{}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}
	payload["mirrorPath"] = "/tmp/mutated.svg"
	for _, got := range a.Objects() {
		if got.ID == o.ID && got.Payload["mirrorPath"] != "/tmp/a.svg" {
			t.Errorf("stored Payload[mirrorPath] = %q, want the original %q (caller mutation leaked through)", got.Payload["mirrorPath"], "/tmp/a.svg")
		}
	}
}

func TestCreateBoardObject_UnknownParent_Errors(t *testing.T) {
	a := newTestAtlasService(t)
	if _, err := a.CreateBoardObject("ink", nil, atlas.Position{}, "does-not-exist"); err == nil {
		t.Error("CreateBoardObject() with an unknown parentID = nil error, want an error")
	}
}

func TestSetBoardObjectPosition_RoundTrips(t *testing.T) {
	a := newTestAtlasService(t)
	o, err := a.CreateBoardObject("ink", nil, atlas.Position{X: 1, Y: 1}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}
	moved, err := a.SetBoardObjectPosition(o.ID, atlas.Position{X: 99, Y: 42})
	if err != nil {
		t.Fatalf("SetBoardObjectPosition: %v", err)
	}
	if moved.Position.X != 99 || moved.Position.Y != 42 {
		t.Errorf("SetBoardObjectPosition's Position = %+v, want {99 42}", moved.Position)
	}
}

func TestSetBoardObjectSize_RoundTrips(t *testing.T) {
	a := newTestAtlasService(t)
	o, err := a.CreateBoardObject("image", nil, atlas.Position{}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}
	resized, err := a.SetBoardObjectSize(o.ID, atlas.Dimensions{W: 320, H: 200})
	if err != nil {
		t.Fatalf("SetBoardObjectSize: %v", err)
	}
	if resized.Size == nil || resized.Size.W != 320 || resized.Size.H != 200 {
		t.Errorf("SetBoardObjectSize's Size = %+v, want {320 200}", resized.Size)
	}
}

func TestSetBoardObjectRotation_RoundTrips(t *testing.T) {
	a := newTestAtlasService(t)
	o, err := a.CreateBoardObject("shape", map[string]string{"shapeType": "rectangle"}, atlas.Position{}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}
	rotated, err := a.SetBoardObjectRotation(o.ID, 45)
	if err != nil {
		t.Fatalf("SetBoardObjectRotation: %v", err)
	}
	if rotated.Payload["rotation"] != "45" {
		t.Errorf("Payload[rotation] = %q, want %q", rotated.Payload["rotation"], "45")
	}
	// The original payload map handed to CreateBoardObject must stay
	// untouched -- a shared reference would leak this write onto the
	// caller's own map.
	if o.Payload["rotation"] != "" {
		t.Errorf("original object's payload was mutated: %+v", o.Payload)
	}
}

func TestSetBoardObjectRotation_UnknownID_Errors(t *testing.T) {
	a := newTestAtlasService(t)
	if _, err := a.SetBoardObjectRotation("missing", 90); err == nil {
		t.Fatal("SetBoardObjectRotation on an unknown id: want an error, got nil")
	}
}

func TestMoveBoardObject_Reparents(t *testing.T) {
	a := newTestAtlasService(t)
	kind, err := a.CreateKind("Frame", "", "", []typedfield.Field{})
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	frame, err := a.CreateCard(kind.ID, "Frame", "", nil, "", nil, atlas.ViewModeCanvas, "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	o, err := a.CreateBoardObject("ink", nil, atlas.Position{}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}
	moved, err := a.MoveBoardObject(o.ID, frame.ID)
	if err != nil {
		t.Fatalf("MoveBoardObject: %v", err)
	}
	if moved.ParentID != frame.ID {
		t.Errorf("MoveBoardObject's ParentID = %q, want %q", moved.ParentID, frame.ID)
	}
}

func TestDeleteBoardObject_RemovesIt(t *testing.T) {
	a := newTestAtlasService(t)
	o, err := a.CreateBoardObject("ink", nil, atlas.Position{}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}
	if _, err := a.DeleteBoardObject(o.ID); err != nil {
		t.Fatalf("DeleteBoardObject: %v", err)
	}
	for _, got := range a.Objects() {
		if got.ID == o.ID {
			t.Error("DeleteBoardObject left the object present in Objects()")
		}
	}
}

func TestDeleteBoardObject_UnknownID_Errors(t *testing.T) {
	a := newTestAtlasService(t)
	if _, err := a.DeleteBoardObject("does-not-exist"); err == nil {
		t.Error("DeleteBoardObject() on an unknown id = nil error, want an error")
	}
}

func TestUndoDelete_RestoresBoardObject(t *testing.T) {
	a := newTestAtlasService(t)
	o, err := a.CreateBoardObject("ink", nil, atlas.Position{}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}
	result, err := a.DeleteBoardObject(o.ID)
	if err != nil {
		t.Fatalf("DeleteBoardObject: %v", err)
	}
	if err := a.UndoDelete(nil, nil, result.ObjectIDs); err != nil {
		t.Fatalf("UndoDelete: %v", err)
	}
	found := false
	for _, got := range a.Objects() {
		if got.ID == o.ID {
			found = true
		}
	}
	if !found {
		t.Error("UndoDelete did not restore the board object")
	}
}

// --- Promotion (mirrors atlasnote_test.go's own atomicity + field-mapping coverage) ---

func TestPromoteBoardObject_BadKind_LeavesObjectUntouched(t *testing.T) {
	a := newTestAtlasService(t)
	o, err := a.CreateBoardObject("image", map[string]string{"mirrorPath": "/tmp/shot.png"}, atlas.Position{X: 5, Y: 7}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}
	if _, err := a.PromoteBoardObject(o.ID, "does-not-exist", "Title"); err == nil {
		t.Fatal("PromoteBoardObject() with an unknown kindID = nil error, want an error")
	}
	found := false
	for _, got := range a.Objects() {
		if got.ID == o.ID {
			found = true
		}
	}
	if !found {
		t.Error("PromoteBoardObject's failure removed the object -- it must survive a bad-kind promotion untouched")
	}
	for _, c := range a.Cards() {
		if c.MirrorPath == "/tmp/shot.png" {
			t.Error("PromoteBoardObject's failure still created a card")
		}
	}
}

func TestPromoteBoardObject_FieldMappingAndAtomicity(t *testing.T) {
	a := newTestAtlasService(t)
	kind, err := a.CreateKind("Reference", "", "", []typedfield.Field{})
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	o, err := a.CreateBoardObject("image", map[string]string{"mirrorPath": "/tmp/shot.png"}, atlas.Position{X: 12, Y: 34}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}

	card, err := a.PromoteBoardObject(o.ID, kind.ID, "Promoted Screenshot")
	if err != nil {
		t.Fatalf("PromoteBoardObject: %v", err)
	}
	if card.KindID != kind.ID {
		t.Errorf("PromoteBoardObject's card KindID = %q, want %q", card.KindID, kind.ID)
	}
	if card.Title != "Promoted Screenshot" {
		t.Errorf("PromoteBoardObject's card Title = %q, want %q", card.Title, "Promoted Screenshot")
	}
	if card.MirrorPath != "/tmp/shot.png" {
		t.Errorf("PromoteBoardObject's card MirrorPath = %q, want the object's own mirrorPath %q", card.MirrorPath, "/tmp/shot.png")
	}
	if card.Position == nil || card.Position.X != 12 || card.Position.Y != 34 {
		t.Errorf("PromoteBoardObject's card Position = %+v, want the object's own position {12 34}", card.Position)
	}

	for _, got := range a.Objects() {
		if got.ID == o.ID {
			t.Error("PromoteBoardObject left the original object present -- promotion must remove it")
		}
	}
	found := false
	for _, c := range a.Cards() {
		if c.ID == card.ID {
			found = true
		}
	}
	if !found {
		t.Error("PromoteBoardObject's card is not present in Cards()")
	}
}

// A "table" object's own Payload key (listID, not mirrorPath) rides
// onto the promoted card's ProjectionListID -- the promoted card keeps
// projecting the SAME List (goal 0179 S2).
func TestPromoteBoardObject_TableCarriesProjectionListID(t *testing.T) {
	a := newTestAtlasService(t)
	kind, err := a.CreateKind("Reference", "", "", []typedfield.Field{})
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	o, err := a.CreateBoardObject("table", map[string]string{"listID": "list-vendors"}, atlas.Position{X: 1, Y: 2}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}

	card, err := a.PromoteBoardObject(o.ID, kind.ID, "Vendors")
	if err != nil {
		t.Fatalf("PromoteBoardObject: %v", err)
	}
	if card.ProjectionListID != "list-vendors" {
		t.Errorf("PromoteBoardObject's card ProjectionListID = %q, want the object's own listID %q", card.ProjectionListID, "list-vendors")
	}
	if card.MirrorPath != "" {
		t.Errorf("PromoteBoardObject's card MirrorPath = %q, want empty for a table object", card.MirrorPath)
	}
}
