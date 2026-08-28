package atlassvc

import (
	"testing"

	"github.com/alicoding/mill/internal/domain/atlas"
)

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

// makeProjectionCard creates a plain card and stamps ProjectionListID
// directly (the production door that once did this, CreateListProjectionCard,
// was retired -- goal 0179 replaced list-projection cards with
// list-backed table board objects). Whitebox: same package as
// AtlasService's internals.
func makeProjectionCard(t *testing.T, a *AtlasService, kind, title, listID string) atlas.Card {
	t.Helper()
	card, err := a.CreateCard(kind, title, "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	a.mu.Lock()
	idx := a.findCardLocked(card.ID)
	if idx == -1 {
		a.mu.Unlock()
		t.Fatalf("no card with id %q", card.ID)
	}
	a.cards[idx].ProjectionListID = listID
	if err := a.persistLocked(); err != nil {
		a.mu.Unlock()
		t.Fatalf("persistLocked: %v", err)
	}
	out := a.cards[idx]
	a.mu.Unlock()
	return out
}

func TestCardListProjection_MissingListAndPlainCards(t *testing.T) {
	a := newTestAtlasService(t)
	wireFakeProjection(a)
	kind := firstKindWithLabel(t, a, "Document")

	card := makeProjectionCard(t, a, kind, "Vendors", "list-vendors")
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

// ObjectListProjection is CardListProjection's own counterpart for a
// board object (goal 0179 S2): live reads, an honest Missing state for
// a deleted List, and an unknown objectID refused outright.
func TestObjectListProjection_LiveMissingAndUnknownObject(t *testing.T) {
	a := newTestAtlasService(t)
	wireFakeProjection(a)
	o, err := a.CreateBoardObject("table", map[string]string{"listID": "list-vendors"}, atlas.Position{}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}

	proj, err := a.ObjectListProjection(o.ID)
	if err != nil {
		t.Fatalf("ObjectListProjection: %v", err)
	}
	if proj.Label != "Vendor tracker" || len(proj.Columns) != 2 || len(proj.Rows) != 1 {
		t.Errorf("projection = %+v, want the wired List view", proj)
	}

	a.WireListProjection(func(string) (ListProjection, bool) { return ListProjection{}, false })
	proj, err = a.ObjectListProjection(o.ID)
	if err != nil {
		t.Fatalf("ObjectListProjection: %v", err)
	}
	if !proj.Missing || proj.ListID != "list-vendors" {
		t.Errorf("projection = %+v, want Missing with the stored id", proj)
	}

	if _, err := a.ObjectListProjection("no-such-object"); err == nil {
		t.Fatal("ObjectListProjection() with an unknown objectID = nil error, want an error")
	}
}

// The resize commit persists a card's footprint and refuses degenerate
// drags (goal 0135 -- the table face was unusably fixed-size before).
func TestSetCardSize_PersistsAndBoundsChecks(t *testing.T) {
	a := newTestAtlasService(t)
	wireFakeProjection(a)
	kind := firstKindWithLabel(t, a, "Document")
	card := makeProjectionCard(t, a, kind, "Vendors", "list-vendors")

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
