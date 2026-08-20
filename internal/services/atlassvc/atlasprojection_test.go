package atlassvc

import "testing"

func wireFakeProjection(a *AtlasService) {
	a.WireListProjection(func(listID string) (ListProjection, bool) {
		if listID != "list-vendors" {
			return ListProjection{}, false
		}
		return ListProjection{
			ListID: "list-vendors", Label: "Vendor tracker",
			Columns: []ProjectionColumn{{Key: "vendor", Label: "Vendor"}, {Key: "status", Label: "Status"}},
			Rows:    []ProjectionRow{{ID: "row-1", Status: "active", Values: map[string]string{"vendor": "Acme", "status": "healthy"}}},
		}, true
	})
}

// The projection principle (goal 0105): the card is a VIEW of the
// List -- creation validates the List resolves, reads are live, and a
// deleted List surfaces as an honest Missing state, never an error.
func TestListProjectionCard_CreateValidatesAndReadsLive(t *testing.T) {
	a := newTestAtlasService(t)
	wireFakeProjection(a)
	kind := firstKindWithLabel(t, a, "Document")

	if _, err := a.CreateListProjectionCard(kind, "Vendors", "", nil, "no-such-list"); err == nil {
		t.Fatal("creation against a missing List must refuse")
	}
	if _, err := a.CreateListProjectionCard(kind, "Vendors", "", nil, " "); err == nil {
		t.Fatal("creation without a List must refuse with the fix")
	}

	card, err := a.CreateListProjectionCard(kind, "Vendors", "", nil, "list-vendors")
	if err != nil {
		t.Fatalf("CreateListProjectionCard: %v", err)
	}
	if card.ProjectionListID != "list-vendors" {
		t.Errorf("ProjectionListID = %q, want list-vendors", card.ProjectionListID)
	}

	proj, err := a.CardListProjection(card.ID)
	if err != nil {
		t.Fatalf("CardListProjection: %v", err)
	}
	if proj.Label != "Vendor tracker" || len(proj.Columns) != 2 || len(proj.Rows) != 1 {
		t.Errorf("projection = %+v, want the wired List view", proj)
	}
	if proj.Rows[0].Values["status"] != "healthy" || proj.Rows[0].ID != "row-1" {
		t.Errorf("row = %+v, want healthy with its id", proj.Rows[0])
	}
}

func TestCardListProjection_MissingListAndPlainCards(t *testing.T) {
	a := newTestAtlasService(t)
	wireFakeProjection(a)
	kind := firstKindWithLabel(t, a, "Document")

	card, err := a.CreateListProjectionCard(kind, "Vendors", "", nil, "list-vendors")
	if err != nil {
		t.Fatalf("CreateListProjectionCard: %v", err)
	}
	// The List disappears after creation: honest Missing, not an error.
	a.WireListProjection(func(string) (ListProjection, bool) { return ListProjection{}, false })
	proj, err := a.CardListProjection(card.ID)
	if err != nil {
		t.Fatalf("CardListProjection: %v", err)
	}
	if !proj.Missing || proj.ListID != "list-vendors" {
		t.Errorf("projection = %+v, want Missing with the stored id", proj)
	}

	plain, err := a.CreateCard(kind, "Plain", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	proj, err = a.CardListProjection(plain.ID)
	if err != nil {
		t.Fatalf("CardListProjection(plain): %v", err)
	}
	if proj.ListID != "" || proj.Missing {
		t.Errorf("plain card projection = %+v, want zero value", proj)
	}
}

// The resize commit persists a card's footprint and refuses degenerate
// drags (goal 0135 -- the table face was unusably fixed-size before).
func TestSetCardSize_PersistsAndBoundsChecks(t *testing.T) {
	a := newTestAtlasService(t)
	wireFakeProjection(a)
	kind := firstKindWithLabel(t, a, "Document")
	card, err := a.CreateListProjectionCard(kind, "Vendors", "", nil, "list-vendors")
	if err != nil {
		t.Fatalf("CreateListProjectionCard: %v", err)
	}

	if _, err := a.SetCardSize(card.ID, 60, 40); err == nil {
		t.Fatal("a degenerate size must refuse")
	}
	if _, err := a.SetCardSize("no-such-card", 400, 300); err == nil {
		t.Fatal("an unknown card must refuse")
	}

	got, err := a.SetCardSize(card.ID, 640, 420)
	if err != nil {
		t.Fatalf("SetCardSize: %v", err)
	}
	if got.Size == nil || got.Size.W != 640 || got.Size.H != 420 {
		t.Errorf("Size = %+v, want 640x420", got.Size)
	}
}
