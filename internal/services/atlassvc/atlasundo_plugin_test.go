package atlassvc

import (
	"testing"

	"github.com/alicoding/mill/internal/domain/atlas"
)

// A plugin-made note without a position lands right of the parent's
// right-most sibling, never on top of one; with a position it lands
// exactly there; an unknown parent is refused.
func TestCreateNoteForPlugin_PlacesRightOfSiblings(t *testing.T) {
	svc := newTestAtlasService(t)
	kindID := svc.Kinds()[0].ID
	root, err := svc.CreateCard(kindID, "Root", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	first, err := svc.CreateNoteForPlugin("first", root.ID, &atlas.Position{X: 100, Y: 50})
	if err != nil || first.Position.X != 100 || first.Position.Y != 50 || first.ParentID != root.ID {
		t.Fatalf("explicit position: %+v %v", first, err)
	}
	second, err := svc.CreateNoteForPlugin("second", root.ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if second.Position.X <= first.Position.X || second.Position.Y != first.Position.Y {
		t.Errorf("auto-placed note at %+v, want right of %+v on its row", second.Position, first.Position)
	}
	if _, err := svc.CreateNoteForPlugin("orphan", "no-such-card", nil); err == nil {
		t.Error("unknown parent must be refused")
	}
	if got := len(svc.Contents(ContentsFilter{Kind: ContentKindNote, ParentID: root.ID})); got != 2 {
		t.Errorf("index lists %d plugin notes under root, want 2", got)
	}
}

func TestCreateCardForPlugin_ListsUnderItsParent(t *testing.T) {
	svc := newTestAtlasService(t)
	kindID := svc.Kinds()[0].ID
	c, err := svc.CreateCardForPlugin(kindID, "Made by a plugin", "note body", map[string]string{}, "")
	if err != nil || c.Title != "Made by a plugin" {
		t.Fatalf("CreateCardForPlugin: %+v %v", c, err)
	}
	updated, err := svc.UpdateCardForPlugin(c.ID, "Renamed by a plugin", "", nil)
	if err != nil || updated.Title != "Renamed by a plugin" {
		t.Fatalf("UpdateCardForPlugin: %+v %v", updated, err)
	}
}
