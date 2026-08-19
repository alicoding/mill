package atlassvc

import (
	"fmt"
	"strings"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/services/dataevent"
)

// List → table projection (goal 0105): a card carrying
// ProjectionListID renders its List as a live, read-only table. The
// List lookup arrives as an injected func from main.go
// (WireListProjection), the same seam shape WireSourceRecognition
// uses -- no service-to-service import, nil (projection off) in tests
// that never wire it.

// ProjectionColumn is one List column's identity for rendering.
type ProjectionColumn struct {
	Key   string
	Label string
}

// ListProjection is the render-ready view of a projected List.
type ListProjection struct {
	ListID string
	Label  string
	// Missing reports an id that no longer resolves -- the card
	// renders the honest missing state instead of erroring the page.
	Missing bool
	Columns []ProjectionColumn
	Rows    []map[string]string
}

type listProjectionFn func(listID string) (ListProjection, bool)

// WireListProjection injects the Configure-side List reader. Called
// once from main.go.
//
//wails:ignore
func (a *AtlasService) WireListProjection(fn listProjectionFn) {
	a.listProjection = fn
}

// CreateListProjectionCard lands a new card projecting listID, kinded
// and titled like any other card (the projection is a facet, not a
// kind). Validates the List resolves at creation -- a projection born
// pointing at nothing is an authoring mistake, refused with the fix.
func (a *AtlasService) CreateListProjectionCard(kindID, title, parentID string, position *atlas.Position, listID string) (atlas.Card, error) {
	if strings.TrimSpace(listID) == "" {
		return atlas.Card{}, fmt.Errorf("pick the List this table should mirror")
	}
	if a.listProjection == nil {
		return atlas.Card{}, fmt.Errorf("list projection is not available in this build")
	}
	if _, ok := a.listProjection(listID); !ok {
		return atlas.Card{}, fmt.Errorf("that List no longer exists -- pick another")
	}
	card, err := a.CreateCard(kindID, title, "", nil, parentID, position, "", "", "", "")
	if err != nil {
		return atlas.Card{}, err
	}
	a.mu.Lock()
	idx := a.findCardLocked(card.ID)
	if idx == -1 {
		a.mu.Unlock()
		return atlas.Card{}, fmt.Errorf("no card with id %q", card.ID)
	}
	a.cards[idx].ProjectionListID = listID
	if err := a.persistLocked(); err != nil {
		a.mu.Unlock()
		return atlas.Card{}, err
	}
	out := a.cards[idx]
	a.mu.Unlock()
	dataevent.Emit("atlas", out.ID)
	return out, nil
}

// CardListProjection resolves a projection card's render data. A
// card without a projection returns the zero value (ListID "");
// a projection whose List was deleted returns Missing=true with the
// stored id, never an error -- the card face owns the honest copy.
func (a *AtlasService) CardListProjection(cardID string) (ListProjection, error) {
	a.mu.RLock()
	idx := a.findCardLocked(cardID)
	if idx == -1 {
		a.mu.RUnlock()
		return ListProjection{}, fmt.Errorf("no card with id %q", cardID)
	}
	listID := a.cards[idx].ProjectionListID
	a.mu.RUnlock()
	if listID == "" || a.listProjection == nil {
		return ListProjection{}, nil
	}
	proj, ok := a.listProjection(listID)
	if !ok {
		return ListProjection{ListID: listID, Missing: true}, nil
	}
	return proj, nil
}
