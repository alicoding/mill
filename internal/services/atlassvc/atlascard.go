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
	return a.createCardWithID(seeding.NewSlugID(title, "card"), kindID, title, note, fields, parentID, position, viewMode, source, mirrorPath, refreshWorkflowID, "")
}

// CreateCardForWorkflow is CreateCard's own logic for an
// apply-atlas-card-create step (goal 0066) -- always root-level
// (parentID ""), no canvas position/view-mode/mirror attributes, since
// a workflow step creates a plain data card, not a space. sourceRunID
// is the writing run's own id, threaded to notifyCardChangeLocked for
// the trigger cycle guard. Not a frontend RPC: composition calls this
// through composition.SetAtlasCardCreator, never Wails directly.
//
//wails:ignore
func (a *AtlasService) CreateCardForWorkflow(kindID, title, note string, fields map[string]string, sourceRunID string) (atlas.Card, error) {
	return a.createCardWithID(seeding.NewSlugID(title, "card"), kindID, title, note, fields, "", nil, "", "", "", "", sourceRunID)
}

// createCardWithID is CreateCard's own logic, parameterized on the new
// card's id -- the seam ImportAtlas uses to preserve a caller-supplied
// id (ADR-0036 decision 3), same shape as compositionsvc's
// createWorkflowWithID/configuresvc's createListWithID. sourceRunID
// (goal 0066) is "" for every caller except CreateCardForWorkflow.
func (a *AtlasService) createCardWithID(id, kindID, title, note string, fields map[string]string, parentID string, position *atlas.Position, viewMode atlas.ViewMode, source, mirrorPath, refreshWorkflowID, sourceRunID string) (atlas.Card, error) {
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
		Source: source, MirrorPath: mirrorPath,
		CreatedAt: now, UpdatedAt: now,
	}
	// Legacy compat (goal 0084): the refreshWorkflowID parameter seeds
	// the first attached ACTION -- the field it used to fill is
	// migrated away and no longer written.
	if refreshWorkflowID != "" {
		c.ActionWorkflowIDs = []string{refreshWorkflowID}
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
	a.notifyCardChange(c, "create", sourceRunID)
	return c, nil
}

// UpdateCard replaces a Card's editable content in place -- ParentID/
// Position move through MoveCard/SetPosition instead, so a plain
// content edit never has to re-run the cycle check. sourceRunID is
// always "" here (a manual Atlas UI edit); MergeCardFields is the
// run-driven counterpart apply-atlas-card-update uses.
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
	a.notifyCardChange(c, "update", "")
	return c, nil
}

// MergeCardFields writes fields onto an existing card's own Fields map,
// leaving everything else (title, note, source, containment...)
// untouched -- the apply-atlas-card-update step's own operation (goal
// 0066), distinct from UpdateCard's wholesale replace: a workflow step
// names only the fields it's actually changing. sourceRunID is the
// writing run's own id, threaded to notifyCardChange for the trigger
// cycle guard. Not a frontend RPC.
//
//wails:ignore
func (a *AtlasService) MergeCardFields(id string, fields map[string]string, sourceRunID string) (atlas.Card, error) {
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
	merged := make(map[string]string, len(c.Fields)+len(fields))
	for k, v := range c.Fields {
		merged[k] = v
	}
	for k, v := range fields {
		merged[k] = v
	}
	c.Fields = merged
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
	a.notifyCardChange(c, "update", sourceRunID)
	return c, nil
}

// CardsByKind returns every card of kindID -- the apply-atlas-card-find
// step's own read (goal 0066), via composition.SetAtlasCardFinder.
func (a *AtlasService) CardsByKind(kindID string) []atlas.Card {
	a.mu.RLock()
	defer a.mu.RUnlock()
	var out []atlas.Card
	for _, c := range a.cards {
		if c.KindID == kindID {
			out = append(out, c)
		}
	}
	return out
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

// DeleteCard removes a card. Containment removal never cascades or
// orphans (goal 0081 A2's dissolve rule, superseding docs/goals/0061's
// original block-while-children-exist guard): every direct child --
// card or note -- promotes to the deleted card's own parent, in the
// same locked section as the delete itself, so a dissolve/delete never
// leaves a half-promoted tree behind. "Dissolve area" and a plain
// Delete on a frame are the same server-side operation; only the
// caller's own confirm copy differs. Deleting a card also removes
// every link touching it.
func (a *AtlasService) DeleteCard(id string) error {
	a.mu.Lock()
	idx := a.findCardLocked(id)
	if idx == -1 {
		a.mu.Unlock()
		return fmt.Errorf("no card with id %q", id)
	}
	removedCard := a.cards[idx]
	wasBuiltIn := removedCard.BuiltIn
	newParentID := removedCard.ParentID
	now := time.Now()

	previousCards := make([]atlas.Card, len(a.cards))
	copy(previousCards, a.cards)
	for i := range a.cards {
		if a.cards[i].ID != id && a.cards[i].ParentID == id {
			a.cards[i].ParentID = newParentID
			a.cards[i].UpdatedAt = now
			a.cards[i].Seed = a.cards[i].Seed.Touch()
		}
	}
	a.cards = append(a.cards[:idx], a.cards[idx+1:]...)

	previousNotes := make([]atlas.Note, len(a.notes))
	copy(previousNotes, a.notes)
	for i := range a.notes {
		if a.notes[i].ParentID == id {
			a.notes[i].ParentID = newParentID
			a.notes[i].UpdatedAt = now
		}
	}

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
			a.cards = previousCards
			a.notes = previousNotes
			a.links = previousLinks
			a.mu.Unlock()
			return fmt.Errorf("tombstone deleted card %q: %w", id, err)
		}
	}
	perr := a.persistLocked()
	if perr != nil {
		a.cards = previousCards
		a.notes = previousNotes
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
