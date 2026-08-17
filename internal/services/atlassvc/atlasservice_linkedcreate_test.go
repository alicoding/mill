package atlassvc

import "testing"

func linkedCreateFixture(t *testing.T) (a *AtlasService, sourceCardID, kindID, linkKindID string) {
	t.Helper()
	a = newBlankAtlasService(t)
	kind, err := a.CreateKind("Topic", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	linkKind, err := a.CreateLinkKind("relates to", "")
	if err != nil {
		t.Fatalf("CreateLinkKind: %v", err)
	}
	source, err := a.CreateCard(kind.ID, "Source", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	return a, source.ID, kind.ID, linkKind.ID
}

func TestCreateCardLinkedFrom_HappyPath_CreatesCardAndLink(t *testing.T) {
	a, sourceID, kindID, linkKindID := linkedCreateFixture(t)

	card, err := a.CreateCardLinkedFrom(sourceID, linkKindID, kindID, "New card", "", nil)
	if err != nil {
		t.Fatalf("CreateCardLinkedFrom: %v", err)
	}
	if card.Title != "New card" {
		t.Errorf("card.Title = %q, want %q", card.Title, "New card")
	}

	links := a.Links()
	if len(links) != 1 {
		t.Fatalf("len(Links()) = %d, want 1", len(links))
	}
	if links[0].FromCardID != sourceID || links[0].ToCardID != card.ID || links[0].LinkKindID != linkKindID {
		t.Errorf("link = %+v, want from=%s to=%s kind=%s", links[0], sourceID, card.ID, linkKindID)
	}
	if len(a.Cards()) != 2 { // the fixture's source card + the new one
		t.Errorf("len(Cards()) = %d, want 2", len(a.Cards()))
	}
}

// TestCreateCardLinkedFrom_BadKind_RollsBackNoCardOrLink pins the
// atomic guarantee the LOCKED design requires: an invalid kind must
// leave neither a stray card nor a stray link behind.
func TestCreateCardLinkedFrom_BadKind_RollsBackNoCardOrLink(t *testing.T) {
	a, sourceID, _, linkKindID := linkedCreateFixture(t)
	before := len(a.Cards())

	if _, err := a.CreateCardLinkedFrom(sourceID, linkKindID, "does-not-exist", "New card", "", nil); err == nil {
		t.Fatal("CreateCardLinkedFrom with an unknown kind = nil error, want an error")
	}
	if len(a.Cards()) != before {
		t.Errorf("len(Cards()) = %d after a rejected create, want unchanged %d", len(a.Cards()), before)
	}
	if len(a.Links()) != 0 {
		t.Errorf("len(Links()) = %d after a rejected create, want 0", len(a.Links()))
	}
}

// TestCreateCardLinkedFrom_BadLinkKind_RollsBackNoCardOrLink is the
// same guarantee from the other invalid input: a link kind that
// doesn't exist must also leave no half-created card behind, even
// though the card itself would otherwise validate fine.
func TestCreateCardLinkedFrom_BadLinkKind_RollsBackNoCardOrLink(t *testing.T) {
	a, sourceID, kindID, _ := linkedCreateFixture(t)
	before := len(a.Cards())

	if _, err := a.CreateCardLinkedFrom(sourceID, "does-not-exist", kindID, "New card", "", nil); err == nil {
		t.Fatal("CreateCardLinkedFrom with an unknown link kind = nil error, want an error")
	}
	if len(a.Cards()) != before {
		t.Errorf("len(Cards()) = %d after a rejected create, want unchanged %d", len(a.Cards()), before)
	}
	if len(a.Links()) != 0 {
		t.Errorf("len(Links()) = %d after a rejected create, want 0", len(a.Links()))
	}
}

func TestCreateCardLinkedFrom_UnknownFromCard_Errors(t *testing.T) {
	a, _, kindID, linkKindID := linkedCreateFixture(t)
	if _, err := a.CreateCardLinkedFrom("does-not-exist", linkKindID, kindID, "New card", "", nil); err == nil {
		t.Fatal("CreateCardLinkedFrom from an unknown card = nil error, want an error")
	}
}

func TestAddLinkedCard_HappyPath_UsesSourceCardsParentAndRelatesTo(t *testing.T) {
	a, _, kindID, linkKindID := linkedCreateFixture(t)
	parent, err := a.CreateCard(kindID, "Parent", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard(parent): %v", err)
	}
	source, err := a.CreateCard(kindID, "Source under parent", "", nil, parent.ID, nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard(source): %v", err)
	}

	card, err := a.AddLinkedCard(source.ID, kindID, "Linked sibling", nil)
	if err != nil {
		t.Fatalf("AddLinkedCard: %v", err)
	}
	if card.ParentID != parent.ID {
		t.Errorf("card.ParentID = %q, want the source card's own parent %q", card.ParentID, parent.ID)
	}

	links := a.Links()
	if len(links) != 1 {
		t.Fatalf("len(Links()) = %d, want 1", len(links))
	}
	if links[0].FromCardID != source.ID || links[0].ToCardID != card.ID || links[0].LinkKindID != linkKindID {
		t.Errorf("link = %+v, want from=%s to=%s kind=%s", links[0], source.ID, card.ID, linkKindID)
	}
}

func TestAddLinkedCard_NoLinkKindDeclared_Errors(t *testing.T) {
	a, sourceID, kindID, linkKindID := linkedCreateFixture(t)
	if err := a.DeleteLinkKind(linkKindID); err != nil {
		t.Fatalf("DeleteLinkKind: %v", err)
	}
	if _, err := a.AddLinkedCard(sourceID, kindID, "New card", nil); err == nil {
		t.Fatal("AddLinkedCard with no link kind declared = nil error, want an error")
	}
}

func TestAddLinkedCard_UnknownFromCard_Errors(t *testing.T) {
	a, _, kindID, _ := linkedCreateFixture(t)
	if _, err := a.AddLinkedCard("does-not-exist", kindID, "New card", nil); err == nil {
		t.Fatal("AddLinkedCard from an unknown card = nil error, want an error")
	}
}

// SetLinkKind is the edge menu's "Change link kind" action -- distinct
// from UpdateLink, which only ever touches Label.
func TestSetLinkKind_ReassignsKind(t *testing.T) {
	a, sourceID, kindID, linkKindID := linkedCreateFixture(t)
	otherKind, err := a.CreateLinkKind("depends on", "")
	if err != nil {
		t.Fatalf("CreateLinkKind: %v", err)
	}
	card, err := a.CreateCardLinkedFrom(sourceID, linkKindID, kindID, "Target", "", nil)
	if err != nil {
		t.Fatalf("CreateCardLinkedFrom: %v", err)
	}
	link := a.Links()[0]

	updated, err := a.SetLinkKind(link.ID, otherKind.ID)
	if err != nil {
		t.Fatalf("SetLinkKind: %v", err)
	}
	if updated.LinkKindID != otherKind.ID {
		t.Errorf("updated.LinkKindID = %q, want %q", updated.LinkKindID, otherKind.ID)
	}
	if updated.ToCardID != card.ID {
		t.Errorf("updated.ToCardID = %q, want unchanged %q", updated.ToCardID, card.ID)
	}
}

func TestSetLinkKind_UnknownLink_Errors(t *testing.T) {
	a, _, _, linkKindID := linkedCreateFixture(t)
	if _, err := a.SetLinkKind("does-not-exist", linkKindID); err == nil {
		t.Fatal("SetLinkKind on an unknown link = nil error, want an error")
	}
}

func TestSetLinkKind_UnknownLinkKind_Errors(t *testing.T) {
	a, sourceID, kindID, linkKindID := linkedCreateFixture(t)
	if _, err := a.CreateCardLinkedFrom(sourceID, linkKindID, kindID, "Target", "", nil); err != nil {
		t.Fatalf("CreateCardLinkedFrom: %v", err)
	}
	link := a.Links()[0]
	if _, err := a.SetLinkKind(link.ID, "does-not-exist"); err == nil {
		t.Fatal("SetLinkKind to an unknown link kind = nil error, want an error")
	}
}
