package atlassvc

import (
	"testing"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/domain/typedfield"
)

// TestDemoteCard_MirrorRoundTrip pins goal 0410 Decision 3's core
// contract for a mirror-backed card: DemoteCard recreates a BoardObject
// carrying the SAME mirrorPath, position and size the card held, and
// undo restores the exact card -- fields and links included, not just
// its bare identity -- since demoteCardToObject/repromoteObjectToCard
// swap the whole struct rather than reconstructing it.
func TestDemoteCard_MirrorRoundTrip(t *testing.T) {
	a := newTestAtlasService(t)
	kind, err := a.CreateKind("Reference", "", "", []typedfield.Field{{Key: "note", Label: "Note", Type: typedfield.TypeText}})
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	obj, err := a.CreateBoardObject("image", map[string]string{"mirrorPath": "/tmp/shot.png"}, atlas.Position{X: 12, Y: 34}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}
	card, err := a.PromoteBoardObject(obj.ID, kind.ID, "Screenshot")
	if err != nil {
		t.Fatalf("PromoteBoardObject: %v", err)
	}
	if _, err := a.SetCardSize(card.ID, 640, 480); err != nil {
		t.Fatalf("SetCardSize: %v", err)
	}
	if _, err := a.UpdateCard(card.ID, card.Title, "a caption", map[string]string{"note": "kept"}, card.Source, card.MirrorPath, ""); err != nil {
		t.Fatalf("UpdateCard: %v", err)
	}
	other, err := a.CreateCard(kind.ID, "Other", "", nil, "", nil, atlas.ViewMode(""), "", "", "")
	if err != nil {
		t.Fatalf("CreateCard(other): %v", err)
	}
	linkKind, err := a.CreateLinkKind("relates to", "")
	if err != nil {
		t.Fatalf("CreateLinkKind: %v", err)
	}
	link, err := a.CreateLink(card.ID, other.ID, linkKind.ID, "")
	if err != nil {
		t.Fatalf("CreateLink: %v", err)
	}
	sized, ok := findCardTestByID(a.Cards(), card.ID)
	if !ok {
		t.Fatalf("card %q missing before demote", card.ID)
	}

	demoted, err := a.DemoteCard(card.ID)
	if err != nil {
		t.Fatalf("DemoteCard: %v", err)
	}
	if demoted.Kind != "image" {
		t.Errorf("DemoteCard's object Kind = %q, want %q", demoted.Kind, "image")
	}
	if demoted.Payload["mirrorPath"] != "/tmp/shot.png" {
		t.Errorf("DemoteCard's object mirrorPath = %q, want %q", demoted.Payload["mirrorPath"], "/tmp/shot.png")
	}
	if demoted.Position != *sized.Position {
		t.Errorf("DemoteCard's object Position = %+v, want the card's own %+v", demoted.Position, *sized.Position)
	}
	if demoted.Size == nil || demoted.Size.W != 640 || demoted.Size.H != 480 {
		t.Errorf("DemoteCard's object Size = %+v, want {640 480}", demoted.Size)
	}
	for _, c := range a.Cards() {
		if c.ID == card.ID {
			t.Error("DemoteCard left the card present -- demote must remove it")
		}
	}
	for _, l := range a.Links() {
		if l.ID == link.ID {
			t.Error("DemoteCard left the card's own link present -- links are removed, per the confirm's own copy")
		}
	}

	if result := a.Undo(); !result.Applied {
		t.Fatalf("Undo() = %+v, want Applied", result)
	}
	restored, ok := findCardTestByID(a.Cards(), card.ID)
	if !ok {
		t.Fatalf("card %q missing after undo", card.ID)
	}
	if restored.Note != "a caption" || restored.Fields["note"] != "kept" {
		t.Errorf("restored card Note/Fields = %q/%v, want the pre-demote values", restored.Note, restored.Fields)
	}
	found := false
	for _, l := range a.Links() {
		if l.FromCardID == card.ID && l.ToCardID == other.ID {
			found = true
		}
	}
	if !found {
		t.Error("undo did not restore the card's own link")
	}
	for _, o := range a.Objects() {
		if o.ID == demoted.ID {
			t.Error("undo left the demoted object present -- it must be removed once the card is back")
		}
	}
}

// TestDemoteCard_ListRoundTrip pins the table/List half: DemoteCard
// recreates a "table" object carrying the card's own ProjectionListID.
func TestDemoteCard_ListRoundTrip(t *testing.T) {
	a := newTestAtlasService(t)
	kind, err := a.CreateKind("Reference", "", "", []typedfield.Field{})
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	obj, err := a.CreateBoardObject("table", map[string]string{"listID": "list-vendors"}, atlas.Position{X: 1, Y: 2}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}
	card, err := a.PromoteBoardObject(obj.ID, kind.ID, "Vendors")
	if err != nil {
		t.Fatalf("PromoteBoardObject: %v", err)
	}

	demoted, err := a.DemoteCard(card.ID)
	if err != nil {
		t.Fatalf("DemoteCard: %v", err)
	}
	if demoted.Kind != "table" {
		t.Errorf("DemoteCard's object Kind = %q, want %q", demoted.Kind, "table")
	}
	if demoted.Payload["listID"] != "list-vendors" {
		t.Errorf("DemoteCard's object listID = %q, want %q", demoted.Payload["listID"], "list-vendors")
	}

	if result := a.Undo(); !result.Applied {
		t.Fatalf("Undo() = %+v, want Applied", result)
	}
	restored, ok := findCardTestByID(a.Cards(), card.ID)
	if !ok {
		t.Fatalf("card %q missing after undo", card.ID)
	}
	if restored.ProjectionListID != "list-vendors" {
		t.Errorf("restored card ProjectionListID = %q, want %q", restored.ProjectionListID, "list-vendors")
	}
}

// TestDemoteCard_NoBackingRejected pins the enablement boundary: a
// card with neither a mirror nor a List projection has nothing for
// DemoteCard to hand back, so it errors rather than inventing an empty
// object.
func TestDemoteCard_NoBackingRejected(t *testing.T) {
	a := newTestAtlasService(t)
	kind, err := a.CreateKind("Reference", "", "", []typedfield.Field{})
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	card, err := a.CreateCard(kind.ID, "Plain", "", nil, "", nil, atlas.ViewMode(""), "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	if _, err := a.DemoteCard(card.ID); err == nil {
		t.Fatal("DemoteCard() on a card with no mirror/list backing = nil error, want an error")
	}
	for _, c := range a.Cards() {
		if c.ID == card.ID {
			return
		}
	}
	t.Error("DemoteCard's rejection still removed the card -- it must survive untouched")
}

func TestDemoteCard_UnknownID(t *testing.T) {
	a := newTestAtlasService(t)
	if _, err := a.DemoteCard("does-not-exist"); err == nil {
		t.Fatal("DemoteCard() on an unknown id = nil error, want an error")
	}
}
