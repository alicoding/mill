package atlassvc

import (
	"testing"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/domain/typedfield"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// newTestAtlasService returns a fresh AtlasService seeded from an
// empty store -- reconcileBuiltIns has already run once by the time
// NewAtlasService returns, so every test below starts with the seeded
// example space present, same as a real fresh install.
func newTestAtlasService(t *testing.T) *AtlasService {
	t.Helper()
	return NewAtlasService(servicetest.NewFakeStore())
}

// --- Kinds ---

func TestCreateKind_RoundTrips(t *testing.T) {
	a := newTestAtlasService(t)
	k, err := a.CreateKind("Widget", "A test kind", "🔧", []typedfield.Field{{Key: "size", Type: typedfield.TypeText}})
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	found := false
	for _, got := range a.Kinds() {
		if got.ID == k.ID {
			found = true
		}
	}
	if !found {
		t.Error("CreateKind's kind is not present in Kinds()")
	}
}

func TestUpdateKind_UnknownID_Errors(t *testing.T) {
	a := newTestAtlasService(t)
	if _, err := a.UpdateKind("does-not-exist", "x", "", "", nil); err == nil {
		t.Error("UpdateKind() on an unknown id = nil error, want an error")
	}
}

func TestDeleteKind_BlockedWhileCardsExist(t *testing.T) {
	a := newTestAtlasService(t)
	k, err := a.CreateKind("Widget", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	if _, err := a.CreateCard(k.ID, "A widget", "", nil, "", nil, "", "", "", ""); err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	if err := a.DeleteKind(k.ID); err == nil {
		t.Error("DeleteKind() while a card still uses it = nil error, want an error (no orphaning)")
	}
}

func TestDeleteKind_UnusedKind_Succeeds(t *testing.T) {
	a := newTestAtlasService(t)
	k, err := a.CreateKind("Widget", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	if err := a.DeleteKind(k.ID); err != nil {
		t.Errorf("DeleteKind() on an unused kind = %v, want nil", err)
	}
}

// --- Link kinds ---

func TestDeleteLinkKind_BlockedWhileLinksExist(t *testing.T) {
	a := newTestAtlasService(t)
	k, err := a.CreateKind("Widget", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	c1, err := a.CreateCard(k.ID, "A", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	c2, err := a.CreateCard(k.ID, "B", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	lk, err := a.CreateLinkKind("connects to", "")
	if err != nil {
		t.Fatalf("CreateLinkKind: %v", err)
	}
	if _, err := a.CreateLink(c1.ID, c2.ID, lk.ID, ""); err != nil {
		t.Fatalf("CreateLink: %v", err)
	}
	if err := a.DeleteLinkKind(lk.ID); err == nil {
		t.Error("DeleteLinkKind() while a link still uses it = nil error, want an error")
	}
}

// --- Cards ---

func TestCreateCard_UnknownKind_Errors(t *testing.T) {
	a := newTestAtlasService(t)
	if _, err := a.CreateCard("does-not-exist", "Card", "", nil, "", nil, "", "", "", ""); err == nil {
		t.Error("CreateCard() with an unknown kind id = nil error, want an error")
	}
}

func TestCreateCard_UnknownParent_Errors(t *testing.T) {
	a := newTestAtlasService(t)
	k, err := a.CreateKind("Widget", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	if _, err := a.CreateCard(k.ID, "Card", "", nil, "does-not-exist", nil, "", "", "", ""); err == nil {
		t.Error("CreateCard() with an unknown parent id = nil error, want an error")
	}
}

func TestCreateCard_UndeclaredFieldKey_Errors(t *testing.T) {
	a := newTestAtlasService(t)
	k, err := a.CreateKind("Widget", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	if _, err := a.CreateCard(k.ID, "Card", "", map[string]string{"unknown": "x"}, "", nil, "", "", "", ""); err == nil {
		t.Error("CreateCard() with an undeclared field key = nil error, want an error")
	}
}

func TestMoveCard_RejectsCycle(t *testing.T) {
	a := newTestAtlasService(t)
	k, err := a.CreateKind("Widget", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	parent, err := a.CreateCard(k.ID, "Parent", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	child, err := a.CreateCard(k.ID, "Child", "", nil, parent.ID, nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	if _, err := a.MoveCard(parent.ID, child.ID); err == nil {
		t.Error("MoveCard() reparenting a card under its own child = nil error, want a cycle-rejection error")
	}
}

func TestMoveCard_RejectsSelfParent(t *testing.T) {
	a := newTestAtlasService(t)
	k, err := a.CreateKind("Widget", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	c, err := a.CreateCard(k.ID, "Card", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	if _, err := a.MoveCard(c.ID, c.ID); err == nil {
		t.Error("MoveCard() reparenting a card under itself = nil error, want an error")
	}
}

func TestMoveCard_ValidReparent_Succeeds(t *testing.T) {
	a := newTestAtlasService(t)
	k, err := a.CreateKind("Widget", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	p1, err := a.CreateCard(k.ID, "P1", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	p2, err := a.CreateCard(k.ID, "P2", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	c, err := a.CreateCard(k.ID, "Card", "", nil, p1.ID, nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	moved, err := a.MoveCard(c.ID, p2.ID)
	if err != nil {
		t.Fatalf("MoveCard: %v", err)
	}
	if moved.ParentID != p2.ID {
		t.Errorf("MoveCard() ParentID = %q, want %q", moved.ParentID, p2.ID)
	}
}

func TestSetPosition_RoundTrips(t *testing.T) {
	a := newTestAtlasService(t)
	k, err := a.CreateKind("Widget", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	c, err := a.CreateCard(k.ID, "Card", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	got, err := a.SetPosition(c.ID, &atlas.Position{X: 10, Y: 20})
	if err != nil {
		t.Fatalf("SetPosition: %v", err)
	}
	if got.Position == nil || got.Position.X != 10 || got.Position.Y != 20 {
		t.Errorf("SetPosition() Position = %+v, want {10 20}", got.Position)
	}
}

func TestSetViewMode_RoundTrips(t *testing.T) {
	a := newTestAtlasService(t)
	k, err := a.CreateKind("Widget", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	c, err := a.CreateCard(k.ID, "Card", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	got, err := a.SetViewMode(c.ID, atlas.ViewModeCanvas)
	if err != nil {
		t.Fatalf("SetViewMode: %v", err)
	}
	if got.ViewMode != atlas.ViewModeCanvas {
		t.Errorf("SetViewMode() ViewMode = %q, want %q", got.ViewMode, atlas.ViewModeCanvas)
	}
}

func TestDeleteCard_BlockedWhileChildrenExist(t *testing.T) {
	a := newTestAtlasService(t)
	k, err := a.CreateKind("Widget", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	parent, err := a.CreateCard(k.ID, "Parent", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	if _, err := a.CreateCard(k.ID, "Child", "", nil, parent.ID, nil, "", "", "", ""); err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	if err := a.DeleteCard(parent.ID); err == nil {
		t.Error("DeleteCard() while it still has children = nil error, want an error (no orphaning)")
	}
}

func TestDeleteCard_RemovesTouchingLinks(t *testing.T) {
	a := newTestAtlasService(t)
	k, err := a.CreateKind("Widget", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	c1, err := a.CreateCard(k.ID, "A", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	c2, err := a.CreateCard(k.ID, "B", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	lk, err := a.CreateLinkKind("connects to", "")
	if err != nil {
		t.Fatalf("CreateLinkKind: %v", err)
	}
	link, err := a.CreateLink(c1.ID, c2.ID, lk.ID, "")
	if err != nil {
		t.Fatalf("CreateLink: %v", err)
	}
	if err := a.DeleteCard(c1.ID); err != nil {
		t.Fatalf("DeleteCard: %v", err)
	}
	for _, l := range a.Links() {
		if l.ID == link.ID {
			t.Error("DeleteCard() left a link touching the deleted card behind")
		}
	}
}

// --- Links ---

func TestCreateLink_UnknownFromCard_Errors(t *testing.T) {
	a := newTestAtlasService(t)
	k, err := a.CreateKind("Widget", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	c, err := a.CreateCard(k.ID, "Card", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	lk, err := a.CreateLinkKind("connects to", "")
	if err != nil {
		t.Fatalf("CreateLinkKind: %v", err)
	}
	if _, err := a.CreateLink("does-not-exist", c.ID, lk.ID, ""); err == nil {
		t.Error("CreateLink() with an unknown from-card id = nil error, want an error")
	}
}

func TestCreateLink_UnknownLinkKind_Errors(t *testing.T) {
	a := newTestAtlasService(t)
	k, err := a.CreateKind("Widget", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	c1, err := a.CreateCard(k.ID, "A", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	c2, err := a.CreateCard(k.ID, "B", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	if _, err := a.CreateLink(c1.ID, c2.ID, "does-not-exist", ""); err == nil {
		t.Error("CreateLink() with an unknown link kind id = nil error, want an error")
	}
}

// --- Lens ---

func TestSetLens_RoundTrips(t *testing.T) {
	a := newTestAtlasService(t)
	if err := a.SetLens("container-1", []string{"kind-a", "kind-b"}); err != nil {
		t.Fatalf("SetLens: %v", err)
	}
	got := a.Lens("container-1")
	if len(got) != 2 || got[0] != "kind-a" || got[1] != "kind-b" {
		t.Errorf("Lens() = %v, want [kind-a kind-b]", got)
	}
}

func TestSetLens_EmptyClearsLens(t *testing.T) {
	a := newTestAtlasService(t)
	if err := a.SetLens("container-1", []string{"kind-a"}); err != nil {
		t.Fatalf("SetLens: %v", err)
	}
	if err := a.SetLens("container-1", nil); err != nil {
		t.Fatalf("SetLens: %v", err)
	}
	if got := a.Lens("container-1"); len(got) != 0 {
		t.Errorf("Lens() after clearing = %v, want empty", got)
	}
}
