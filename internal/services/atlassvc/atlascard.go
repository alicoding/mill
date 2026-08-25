package atlassvc

import (
	"fmt"
	"github.com/alicoding/mill/internal/adapters/markdown"
	"time"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/domain/typedfield"
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
	return a.createCardWithID(seeding.NewSlugID(title, "card"), kindID, title, note, fields, parentID, position, viewMode, source, mirrorPath, "", refreshWorkflowID, "", actorUI)
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
	return a.createCardWithID(seeding.NewSlugID(title, "card"), kindID, title, note, fields, "", nil, "", "", "", "", "", sourceRunID, actorWorkflow)
}

// createCardWithID is CreateCard's own logic, parameterized on the new
// card's id -- the seam ImportAtlas uses to preserve a caller-supplied
// id (ADR-0036 decision 3), same shape as compositionsvc's
// createWorkflowWithID/configuresvc's createListWithID. sourceRunID
// (goal 0066) is "" for every caller except CreateCardForWorkflow.
// actor is ADR-0044's own per-call actor tag ("" skips journaling
// entirely -- background/bulk callers like docs/ledger sync and
// ImportAtlas that aren't a single user gesture, out of v1 scope).
func (a *AtlasService) createCardWithID(id, kindID, title, note string, fields map[string]string, parentID string, position *atlas.Position, viewMode atlas.ViewMode, source, mirrorPath, mirrorChecksum, refreshWorkflowID, sourceRunID string, actor undoActor) (atlas.Card, error) {
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
		Source: source, MirrorPath: mirrorPath, MirrorChecksum: mirrorChecksum,
		CreatedAt: now, UpdatedAt: now,
	}
	// Legacy compat (goal 0084): the refreshWorkflowID parameter seeds
	// the first attached ACTION -- the field it used to fill is
	// migrated away and no longer written.
	if refreshWorkflowID != "" {
		c.ActionWorkflowIDs = []string{refreshWorkflowID}
	}
	if err := a.validateCardRefsLocked(kind, c.Fields); err != nil {
		a.mu.Unlock()
		return atlas.Card{}, err
	}
	if err := atlas.ValidateCard(c, kind); err != nil {
		a.mu.Unlock()
		return atlas.Card{}, err
	}
	a.cards = append(a.cards, c)
	// Authoring-while-active (ADR-0041): a card created while a
	// perspective is active joins it, ancestry closed. Snapshot first --
	// a persist failure below must roll this back too.
	previousPerspectives := append([]atlas.Perspective(nil), a.perspectives...)
	a.joinActivePerspectiveWithCardLocked(c.ID)
	perr := a.persistLocked()
	if perr != nil {
		a.cards = a.cards[:len(a.cards)-1]
		a.perspectives = previousPerspectives
	}
	a.mu.Unlock()
	if perr != nil {
		return atlas.Card{}, fmt.Errorf("save card: %w", perr)
	}
	dataevent.Emit("atlas", c.ID)
	a.armMirrorWatch(c.ID, c.MirrorPath)
	a.notifyCardChange(c, "create", sourceRunID)
	if actor != "" {
		created := c.ID
		a.recordUndo(actor, "card", created, c.Title,
			func(a *AtlasService) error { _, err := a.DeleteCard(created); return err },
			func(a *AtlasService) error { return a.UndoDelete([]string{created}, nil, nil) },
		)
	}
	return c, nil
}

// UpdateCard replaces a Card's editable content in place -- ParentID/
// Position move through MoveCard/SetPosition instead, so a plain
// content edit never has to re-run the cycle check. sourceRunID is
// always "" here (a manual Atlas UI edit); MergeCardFields is the
// run-driven counterpart apply-atlas-card-update uses.
// validateCardRefsLocked checks every cardref field value against live
// cards (docs/goals/0152 slice 2): the target must exist and, when the
// field declares a target kind (RefKind carries the atlas kind id for
// Type cardref), be of that kind. Storage-aware by design -- the pure
// typedfield layer can't see cards, so this is the write path's own
// half of the check. Caller holds a.mu.
func (a *AtlasService) validateCardRefsLocked(kind atlas.Kind, fields map[string]string) error {
	for _, f := range kind.Fields {
		if f.Type != typedfield.TypeCardRef {
			continue
		}
		v := fields[f.Key]
		if v == "" {
			continue
		}
		idx := a.findCardLocked(v)
		if idx == -1 {
			return fmt.Errorf("field %q references card %q, which does not exist", f.Label, v)
		}
		if f.RefKind != "" && a.cards[idx].KindID != f.RefKind {
			return fmt.Errorf("field %q must reference a card of its declared kind", f.Label)
		}
	}
	return nil
}

func (a *AtlasService) UpdateCard(id, title, note string, fields map[string]string, source, mirrorPath, refreshWorkflowID string) (atlas.Card, error) {
	c, previous, err := a.updateCardCore(id, title, note, fields, source, mirrorPath, refreshWorkflowID)
	if err != nil {
		return c, err
	}
	recordCardContentUndo(a, actorUI, id, title, previous, c)
	return c, nil
}

// updateCardCore is UpdateCard/UpdateCardForMCP's own shared body --
// validation, mutation, persist, dataevent, and the trigger-cycle
// notify -- WITHOUT the journal call, so each exported wrapper decides
// its own actor tag right at the call site rather than duplicating this
// logic (ADR-0044's actor-scoping needs no shared mutable state this
// way: which wrapper you called IS the actor).
func (a *AtlasService) updateCardCore(id, title, note string, fields map[string]string, source, mirrorPath, refreshWorkflowID string) (updated, previous atlas.Card, err error) {
	a.mu.Lock()
	idx := a.findCardLocked(id)
	if idx == -1 {
		a.mu.Unlock()
		return atlas.Card{}, atlas.Card{}, fmt.Errorf("no card with id %q", id)
	}
	kind, err := a.resolveKindLocked(a.cards[idx].KindID)
	if err != nil {
		a.mu.Unlock()
		return atlas.Card{}, atlas.Card{}, err
	}
	previous = a.cards[idx]
	c := previous
	newFields := make(map[string]string, len(fields))
	for k, v := range fields {
		newFields[k] = v
	}
	c.Title, c.Note, c.Fields = title, note, newFields
	c.Source, c.MirrorPath, c.RefreshWorkflowID = source, mirrorPath, refreshWorkflowID
	c.UpdatedAt = time.Now()
	c.Seed = c.Seed.Touch()
	applyStampOnChangeLocked(kind, previous.Fields, c.Fields)
	if err := a.validateCardRefsLocked(kind, c.Fields); err != nil {
		a.mu.Unlock()
		return atlas.Card{}, atlas.Card{}, err
	}
	if err := atlas.ValidateCard(c, kind); err != nil {
		a.mu.Unlock()
		return atlas.Card{}, atlas.Card{}, err
	}
	a.cards[idx] = c
	perr := a.persistLocked()
	if perr != nil {
		a.cards[idx] = previous
	}
	a.mu.Unlock()
	if perr != nil {
		return atlas.Card{}, atlas.Card{}, fmt.Errorf("save card: %w", perr)
	}
	dataevent.Emit("atlas", c.ID)
	a.notifyCardChange(c, "update", "")
	return c, previous, nil
}

// recordCardContentUndo is UpdateCard/UpdateCardForMCP's shared
// journal call (ADR-0044's content family): undo restores every
// previously-touched field through the same door; redo re-applies what
// was just written.
func recordCardContentUndo(a *AtlasService, actor undoActor, id, label string, previous, next atlas.Card) {
	a.recordUndo(actor, "card", id, label,
		func(a *AtlasService) error {
			_, _, err := a.updateCardCore(id, previous.Title, previous.Note, previous.Fields, previous.Source, previous.MirrorPath, previous.RefreshWorkflowID)
			return err
		},
		func(a *AtlasService) error {
			_, _, err := a.updateCardCore(id, next.Title, next.Note, next.Fields, next.Source, next.MirrorPath, next.RefreshWorkflowID)
			return err
		},
	)
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
	applyStampOnChangeLocked(kind, previous.Fields, c.Fields)
	if err := a.validateCardRefsLocked(kind, c.Fields); err != nil {
		a.mu.Unlock()
		return atlas.Card{}, err
	}
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

// applyStampOnChangeLocked stamps every field.StampOnChange target
// with today's date when that field's own new value differs from both
// its previous stored value and its Default (typedfield.Field.
// StampOnChange, docs/goals/0164) -- schema-driven, not tied to any
// specific Kind: any Options field can declare a companion date field
// this way. Mutates fields in place, overwriting whatever the caller
// supplied for the stamped key -- the transition is recorded
// server-side, never trusting a client-submitted date. Caller must
// hold a.mu and pass a fields map safe to mutate (a fresh copy/merge
// result, never the caller-supplied map verbatim).
func applyStampOnChangeLocked(kind atlas.Kind, previous, fields map[string]string) {
	for _, f := range kind.Fields {
		if f.StampOnChange == "" {
			continue
		}
		newVal := fields[f.Key]
		if newVal == previous[f.Key] || newVal == f.Default {
			continue
		}
		fields[f.StampOnChange] = time.Now().Format("2006-01-02")
	}
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
	recordScalar(a, actorUI, "card", id, c.Title,
		func(a *AtlasService, p string) error { _, err := a.MoveCard(id, p); return err },
		previous.ParentID, newParentID,
	)
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
	recordScalar(a, actorUI, "card", id, c.Title,
		func(a *AtlasService, p *atlas.Position) error { _, err := a.SetPosition(id, p); return err },
		previous.Position, position,
	)
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

// DeleteCard lives in atlasservice_tombstone.go (goal 0093's soft-
// delete guard) -- containment promotion is now VIRTUAL (a live
// child's effective parent is resolved at read time, past any
// tombstoned ancestor) rather than a data rewrite at delete time; the
// real re-parent only happens at purge.

// RenderNoteMarkdown converts a card note's markdown source to safe
// HTML (goal 0145) -- the same GFM renderer + raw-HTML-escaping the
// mirror preview and Docs view already trust.
func (a *AtlasService) RenderNoteMarkdown(source string) (string, error) {
	return markdown.RenderHTML(source)
}
