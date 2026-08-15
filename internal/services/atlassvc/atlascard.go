package atlassvc

import (
	"fmt"
	"time"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/seeding"
)

// resolveKindLocked returns the Kind named by id -- the referential-
// existence check internal/domain/atlas.ValidateCard deliberately
// leaves to this layer (docs/goals/0061's Validation note). Caller
// must hold a.mu.
func (a *AtlasService) resolveKindLocked(id string) (atlas.Kind, error) {
	if idx := a.findKindLocked(id); idx != -1 {
		return a.kinds[idx], nil
	}
	return atlas.Kind{}, fmt.Errorf("no kind with id %q", id)
}

// --- Cards ---

// CreateCard makes a new Card of kindID, optionally inside parentID
// ("" for root-level). A non-empty parentID must name an existing
// card; a fresh card can never itself be a cycle (it has no children
// yet), so no cycle check is needed here -- MoveCard is where
// reparenting an EXISTING card (which may have its own descendants)
// needs one.
func (a *AtlasService) CreateCard(kindID, title, note string, fields map[string]string, parentID string, position *atlas.Position, viewMode atlas.ViewMode, source, mirrorPath, refreshWorkflowID string) (atlas.Card, error) {
	return a.createCardWithID(seeding.NewSlugID(title, "card"), kindID, title, note, fields, parentID, position, viewMode, source, mirrorPath, refreshWorkflowID)
}

// createCardWithID is CreateCard's own logic, parameterized on the new
// card's id -- the seam ImportAtlas uses to preserve a caller-supplied
// id (ADR-0036 decision 3), same shape as compositionsvc's
// createWorkflowWithID/configuresvc's createListWithID.
func (a *AtlasService) createCardWithID(id, kindID, title, note string, fields map[string]string, parentID string, position *atlas.Position, viewMode atlas.ViewMode, source, mirrorPath, refreshWorkflowID string) (atlas.Card, error) {
	a.mu.Lock()
	kind, err := a.resolveKindLocked(kindID)
	if err != nil {
		a.mu.Unlock()
		return atlas.Card{}, err
	}
	if parentID != "" && a.findCardLocked(parentID) == -1 {
		a.mu.Unlock()
		return atlas.Card{}, fmt.Errorf("no card with id %q to contain this one", parentID)
	}
	now := time.Now()
	c := atlas.Card{
		ID: id, KindID: kindID, Title: title, Note: note,
		Fields: fields, ParentID: parentID, Position: position, ViewMode: viewMode,
		Source: source, MirrorPath: mirrorPath, RefreshWorkflowID: refreshWorkflowID,
		CreatedAt: now, UpdatedAt: now,
	}
	if err := atlas.ValidateCard(c, kind); err != nil {
		a.mu.Unlock()
		return atlas.Card{}, err
	}
	a.cards = append(a.cards, c)
	perr := a.persistLocked()
	if perr != nil {
		a.cards = a.cards[:len(a.cards)-1]
	}
	a.mu.Unlock()
	if perr != nil {
		return atlas.Card{}, fmt.Errorf("save card: %w", perr)
	}
	dataevent.Emit("atlas", c.ID)
	return c, nil
}

// UpdateCard replaces a Card's editable content in place -- ParentID/
// Position move through MoveCard/SetPosition instead, so a plain
// content edit never has to re-run the cycle check.
func (a *AtlasService) UpdateCard(id, title, note string, fields map[string]string, source, mirrorPath, refreshWorkflowID string) (atlas.Card, error) {
	a.mu.Lock()
	idx := a.findCardLocked(id)
	if idx == -1 {
		a.mu.Unlock()
		return atlas.Card{}, fmt.Errorf("no card with id %q", id)
	}
	kind, err := a.resolveKindLocked(a.cards[idx].KindID)
	if err != nil {
		a.mu.Unlock()
		return atlas.Card{}, err
	}
	previous := a.cards[idx]
	c := previous
	c.Title, c.Note, c.Fields = title, note, fields
	c.Source, c.MirrorPath, c.RefreshWorkflowID = source, mirrorPath, refreshWorkflowID
	c.UpdatedAt = time.Now()
	c.Seed = c.Seed.Touch()
	if err := atlas.ValidateCard(c, kind); err != nil {
		a.mu.Unlock()
		return atlas.Card{}, err
	}
	a.cards[idx] = c
	perr := a.persistLocked()
	if perr != nil {
		a.cards[idx] = previous
	}
	a.mu.Unlock()
	if perr != nil {
		return atlas.Card{}, fmt.Errorf("save card: %w", perr)
	}
	dataevent.Emit("atlas", c.ID)
	return c, nil
}

// MoveCard reparents a card (sibling-vs-child move, ADR-0038's
// create-time framing extended to a later move) -- rejects a
// newParentID that would make the card its own ancestor
// (atlas.WouldCycle) and one that doesn't exist.
func (a *AtlasService) MoveCard(id, newParentID string) (atlas.Card, error) {
	a.mu.Lock()
	idx := a.findCardLocked(id)
	if idx == -1 {
		a.mu.Unlock()
		return atlas.Card{}, fmt.Errorf("no card with id %q", id)
	}
	if newParentID != "" && a.findCardLocked(newParentID) == -1 {
		a.mu.Unlock()
		return atlas.Card{}, fmt.Errorf("no card with id %q to contain this one", newParentID)
	}
	if atlas.WouldCycle(id, newParentID, a.cardsByIDLocked()) {
		a.mu.Unlock()
		return atlas.Card{}, fmt.Errorf("moving card %q under %q would make it its own ancestor", id, newParentID)
	}
	previous := a.cards[idx]
	c := previous
	c.ParentID = newParentID
	c.UpdatedAt = time.Now()
	c.Seed = c.Seed.Touch()
	a.cards[idx] = c
	perr := a.persistLocked()
	if perr != nil {
		a.cards[idx] = previous
	}
	a.mu.Unlock()
	if perr != nil {
		return atlas.Card{}, fmt.Errorf("save card move: %w", perr)
	}
	dataevent.Emit("atlas", c.ID)
	return c, nil
}

// SetPosition updates a card's placement within its parent's canvas.
// A nil position is accepted (clearing it, e.g. after a move to a
// shelves-mode parent) -- no validation ties Position to the parent's
// current ViewMode, since a position saved while canvas-mode simply
// goes unread while shelves-mode is active, exactly as
// docs/goals/0061 describes it ("only meaningful in canvas-mode
// containers").
func (a *AtlasService) SetPosition(id string, position *atlas.Position) (atlas.Card, error) {
	a.mu.Lock()
	idx := a.findCardLocked(id)
	if idx == -1 {
		a.mu.Unlock()
		return atlas.Card{}, fmt.Errorf("no card with id %q", id)
	}
	previous := a.cards[idx]
	c := previous
	c.Position = position
	c.UpdatedAt = time.Now()
	c.Seed = c.Seed.Touch()
	a.cards[idx] = c
	perr := a.persistLocked()
	if perr != nil {
		a.cards[idx] = previous
	}
	a.mu.Unlock()
	if perr != nil {
		return atlas.Card{}, fmt.Errorf("save card position: %w", perr)
	}
	dataevent.Emit("atlas", c.ID)
	return c, nil
}

// SetViewMode sets how id's OWN children render (atlas.Card.ViewMode's
// container-config role) -- id need not currently have any children.
func (a *AtlasService) SetViewMode(id string, mode atlas.ViewMode) (atlas.Card, error) {
	a.mu.Lock()
	idx := a.findCardLocked(id)
	if idx == -1 {
		a.mu.Unlock()
		return atlas.Card{}, fmt.Errorf("no card with id %q", id)
	}
	previous := a.cards[idx]
	c := previous
	c.ViewMode = mode
	c.UpdatedAt = time.Now()
	c.Seed = c.Seed.Touch()
	a.cards[idx] = c
	perr := a.persistLocked()
	if perr != nil {
		a.cards[idx] = previous
	}
	a.mu.Unlock()
	if perr != nil {
		return atlas.Card{}, fmt.Errorf("save card view mode: %w", perr)
	}
	dataevent.Emit("atlas", c.ID)
	return c, nil
}

// DeleteCard removes a card, blocked while it still has children --
// no orphaning, explicit per docs/goals/0061 (goal 0046 will refine
// this further, not duplicated here). Deleting a card removes every
// link touching it.
func (a *AtlasService) DeleteCard(id string) error {
	a.mu.Lock()
	idx := a.findCardLocked(id)
	if idx == -1 {
		a.mu.Unlock()
		return fmt.Errorf("no card with id %q", id)
	}
	for _, c := range a.cards {
		if c.ParentID == id {
			a.mu.Unlock()
			return fmt.Errorf("card %q still contains card %q -- move or delete its children first", id, c.ID)
		}
	}
	removedCard := a.cards[idx]
	wasBuiltIn := removedCard.BuiltIn
	a.cards = append(a.cards[:idx], a.cards[idx+1:]...)

	remainingLinks := make([]atlas.Link, 0, len(a.links))
	removedLinks := make([]atlas.Link, 0)
	for _, l := range a.links {
		if l.FromCardID == id || l.ToCardID == id {
			removedLinks = append(removedLinks, l)
			continue
		}
		remainingLinks = append(remainingLinks, l)
	}
	previousLinks := a.links
	a.links = remainingLinks

	if wasBuiltIn {
		if err := seeding.RecordTombstone(a.store, id); err != nil {
			a.cards = insertCardAt(a.cards, idx, removedCard)
			a.links = previousLinks
			a.mu.Unlock()
			return fmt.Errorf("tombstone deleted card %q: %w", id, err)
		}
	}
	perr := a.persistLocked()
	if perr != nil {
		a.cards = insertCardAt(a.cards, idx, removedCard)
		a.links = previousLinks
	}
	a.mu.Unlock()
	if perr != nil {
		return fmt.Errorf("save card deletion: %w", perr)
	}
	dataevent.Emit("atlas", id)
	for _, l := range removedLinks {
		dataevent.Emit("atlas", l.ID)
	}
	return nil
}

func insertCardAt(cards []atlas.Card, idx int, c atlas.Card) []atlas.Card {
	if idx < 0 || idx > len(cards) {
		idx = len(cards)
	}
	cards = append(cards, atlas.Card{})
	copy(cards[idx+1:], cards[idx:])
	cards[idx] = c
	return cards
}
