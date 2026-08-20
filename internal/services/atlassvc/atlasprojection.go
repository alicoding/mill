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
// Options/OptionColors ride along so an options column renders as a
// colored pill (goal 0105 part 3) -- color resolution (explicit else
// palette-by-index) is the frontend's one pure function.
type ProjectionColumn struct {
	Key   string
	Label string
	// Type is the column's typedfield type name ("text", "number",
	// "boolean", "options") -- the grid's cell editors key off it.
	Type         string
	Options      []string
	OptionColors []string
	// Deprecated mirrors the field's soft-retired flag (ADR-0040) so
	// the grid's schema popover shows the stored truth.
	Deprecated bool
}

// ProjectionRow is one List row with the identity in-place editing
// commits against (UpdateListRow needs the row id, and the current
// Status must round-trip -- a cell edit must never flip an Expired
// row back to Active).
type ProjectionRow struct {
	ID     string
	Status string
	Values map[string]string
}

// ListProjection is the render-ready view of a projected List.
type ListProjection struct {
	ListID string
	Label  string
	// Missing reports an id that no longer resolves -- the card
	// renders the honest missing state instead of erroring the page.
	Missing bool
	Columns []ProjectionColumn
	Rows    []ProjectionRow
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
	// An empty kindID defaults to the seeded Reference kind (goal 0137:
	// the size picker asks no identity questions) -- falling back to
	// the first kind when Reference was deleted, so creation never
	// fails over a default the user didn't pick.
	if strings.TrimSpace(kindID) == "" {
		kindID = a.defaultProjectionKindLocked()
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

// SetCardProjectionDensity persists the projection's render mode
// ("", "grid", "pills") -- validated against the closed set so a bad
// wire value can't persist.
func (a *AtlasService) SetCardProjectionDensity(cardID, density string) (atlas.Card, error) {
	if density != "" && density != "grid" && density != "pills" {
		return atlas.Card{}, fmt.Errorf("unknown table density %q", density)
	}
	a.mu.Lock()
	idx := a.findCardLocked(cardID)
	if idx == -1 {
		a.mu.Unlock()
		return atlas.Card{}, fmt.Errorf("no card with id %q", cardID)
	}
	a.cards[idx].ProjectionDensity = density
	if err := a.persistLocked(); err != nil {
		a.mu.Unlock()
		return atlas.Card{}, err
	}
	out := a.cards[idx]
	a.mu.Unlock()
	dataevent.Emit("atlas", out.ID)
	return out, nil
}

// defaultProjectionKindLocked picks the kind a kind-less projection
// card lands as. Takes the read lock itself; call unlocked.
func (a *AtlasService) defaultProjectionKindLocked() string {
	a.mu.RLock()
	defer a.mu.RUnlock()
	first := ""
	for _, k := range a.kinds {
		if k.ID == atlas.ReferenceKindID {
			return k.ID
		}
		if first == "" {
			first = k.ID
		}
	}
	return first
}

// SetCardSize persists a card's user-chosen board footprint (the
// resize handle's commit). Bounds guard against a degenerate drag:
// anything under 120x80 canvas units can't render a usable face.
func (a *AtlasService) SetCardSize(cardID string, w, h float64) (atlas.Card, error) {
	if w < 120 || h < 80 {
		return atlas.Card{}, fmt.Errorf("card size %.0fx%.0f is too small", w, h)
	}
	a.mu.Lock()
	idx := a.findCardLocked(cardID)
	if idx == -1 {
		a.mu.Unlock()
		return atlas.Card{}, fmt.Errorf("no card with id %q", cardID)
	}
	a.cards[idx].Size = &atlas.Dimensions{W: w, H: h}
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
