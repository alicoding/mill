package atlassvc

import (
	"fmt"
	"time"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/domain/typedfield"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/seeding"
)

// --- Kinds ---

func (a *AtlasService) CreateKind(label, description, icon string, fields []typedfield.Field) (atlas.Kind, error) {
	return a.createKindWithID(seeding.NewSlugID(label, "kind"), label, description, icon, fields, nil)
}

// createKindWithID is CreateKind's own logic, parameterized on the new
// Kind's id -- the seam ImportAtlas uses to preserve a caller-supplied
// id (ADR-0036 decision 3), same shape as compositionsvc's
// createWorkflowWithID/configuresvc's createListWithID.
// fieldTombstones lets an import carry a portable export's own
// deletion history forward onto the fresh local entity (nil for every
// ordinary CreateKind call, which starts with none) -- same
// createDecisionWithID/createListWithID shape.
func (a *AtlasService) createKindWithID(id, label, description, icon string, fields []typedfield.Field, fieldTombstones []typedfield.FieldTombstone) (atlas.Kind, error) {
	now := time.Now()
	k := atlas.Kind{
		ID: id, Label: label, Description: description,
		Icon: icon, Fields: fields, FieldTombstones: fieldTombstones,
		CreatedAt: now, UpdatedAt: now,
	}
	if err := atlas.ValidateKind(k); err != nil {
		return atlas.Kind{}, err
	}

	a.mu.Lock()
	a.kinds = append(a.kinds, k)
	err := a.persistLocked()
	if err != nil {
		a.kinds = a.kinds[:len(a.kinds)-1]
	}
	a.mu.Unlock()
	if err != nil {
		return atlas.Kind{}, fmt.Errorf("save kind: %w", err)
	}
	dataevent.Emit("atlas", k.ID)
	return k, nil
}

// UpdateKind enforces ADR-0040's field-evolution grammar on Fields --
// the same chokepoint configuresvc.UpdateDecision/UpdateList already
// apply to Outputs/Columns (typedfield.ValidateFieldEvolution's own
// doc comment has the full rule). newFieldTombstones names any Key+
// Type this call is deleting from Fields right now -- the explicit,
// UI-declared half of the evolution check.
func (a *AtlasService) UpdateKind(id, label, description, icon string, fields []typedfield.Field, newFieldTombstones []typedfield.FieldTombstone) (atlas.Kind, error) {
	a.mu.Lock()
	idx := a.findKindLocked(id)
	if idx == -1 {
		a.mu.Unlock()
		return atlas.Kind{}, fmt.Errorf("no kind with id %q", id)
	}
	previous := a.kinds[idx]
	a.mu.Unlock()

	tombstones := typedfield.MergeTombstones(previous.FieldTombstones, newFieldTombstones)
	if err := typedfield.ValidateFieldEvolution(previous.Fields, fields, tombstones); err != nil {
		return atlas.Kind{}, err
	}

	a.mu.Lock()
	idx = a.findKindLocked(id)
	if idx == -1 {
		a.mu.Unlock()
		return atlas.Kind{}, fmt.Errorf("no kind with id %q", id)
	}
	previous = a.kinds[idx]
	k := previous
	k.Label, k.Description, k.Icon, k.Fields, k.FieldTombstones = label, description, icon, fields, tombstones
	k.UpdatedAt = time.Now()
	k.Seed = k.Seed.Touch()
	if err := atlas.ValidateKind(k); err != nil {
		a.mu.Unlock()
		return atlas.Kind{}, err
	}
	a.kinds[idx] = k
	err := a.persistLocked()
	if err != nil {
		a.kinds[idx] = previous
	}
	a.mu.Unlock()
	if err != nil {
		return atlas.Kind{}, fmt.Errorf("save kind: %w", err)
	}
	dataevent.Emit("atlas", k.ID)
	return k, nil
}

// DeleteKind removes a Kind, blocked while any Card still references
// it -- no orphaning (docs/goals/0061's Deletion semantics; goal 0046
// will refine reference handling further, not duplicated here).
func (a *AtlasService) DeleteKind(id string) error {
	a.mu.Lock()
	idx := a.findKindLocked(id)
	if idx == -1 {
		a.mu.Unlock()
		return fmt.Errorf("no kind with id %q", id)
	}
	// A tombstoned card (goal 0093) never blocks Kind deletion -- it's
	// already invisible to the user and its own reference disappears
	// for real at purge.
	for _, c := range a.liveCardsLocked() {
		if c.KindID == id {
			a.mu.Unlock()
			return fmt.Errorf("kind %q is still used by card %q -- delete or re-kind that card first", id, c.ID)
		}
	}
	removed := a.kinds[idx]
	wasBuiltIn := removed.BuiltIn
	a.kinds = append(a.kinds[:idx], a.kinds[idx+1:]...)
	if wasBuiltIn {
		if err := seeding.RecordTombstone(a.store, id); err != nil {
			a.kinds = insertKindAt(a.kinds, idx, removed)
			a.mu.Unlock()
			return fmt.Errorf("tombstone deleted kind %q: %w", id, err)
		}
	}
	err := a.persistLocked()
	if err != nil {
		a.kinds = insertKindAt(a.kinds, idx, removed)
	}
	a.mu.Unlock()
	if err != nil {
		return fmt.Errorf("save kind deletion: %w", err)
	}
	dataevent.Emit("atlas", id)
	return nil
}

func insertKindAt(kinds []atlas.Kind, idx int, k atlas.Kind) []atlas.Kind {
	if idx < 0 || idx > len(kinds) {
		idx = len(kinds)
	}
	kinds = append(kinds, atlas.Kind{})
	copy(kinds[idx+1:], kinds[idx:])
	kinds[idx] = k
	return kinds
}

// --- Link kinds ---

func (a *AtlasService) CreateLinkKind(label, description string) (atlas.LinkKind, error) {
	return a.createLinkKindWithID(seeding.NewSlugID(label, "linkkind"), label, description)
}

// createLinkKindWithID is CreateLinkKind's own logic, parameterized on
// the new LinkKind's id -- the seam ImportAtlas uses to preserve a
// caller-supplied id (ADR-0036 decision 3).
func (a *AtlasService) createLinkKindWithID(id, label, description string) (atlas.LinkKind, error) {
	now := time.Now()
	lk := atlas.LinkKind{
		ID: id, Label: label, Description: description,
		CreatedAt: now, UpdatedAt: now,
	}
	if err := atlas.ValidateLinkKind(lk); err != nil {
		return atlas.LinkKind{}, err
	}

	a.mu.Lock()
	a.linkKinds = append(a.linkKinds, lk)
	err := a.persistLocked()
	if err != nil {
		a.linkKinds = a.linkKinds[:len(a.linkKinds)-1]
	}
	a.mu.Unlock()
	if err != nil {
		return atlas.LinkKind{}, fmt.Errorf("save link kind: %w", err)
	}
	dataevent.Emit("atlas", lk.ID)
	return lk, nil
}

func (a *AtlasService) UpdateLinkKind(id, label, description string) (atlas.LinkKind, error) {
	a.mu.Lock()
	idx := a.findLinkKindLocked(id)
	if idx == -1 {
		a.mu.Unlock()
		return atlas.LinkKind{}, fmt.Errorf("no link kind with id %q", id)
	}
	previous := a.linkKinds[idx]
	lk := previous
	lk.Label, lk.Description = label, description
	lk.UpdatedAt = time.Now()
	lk.Seed = lk.Seed.Touch()
	if err := atlas.ValidateLinkKind(lk); err != nil {
		a.mu.Unlock()
		return atlas.LinkKind{}, err
	}
	a.linkKinds[idx] = lk
	err := a.persistLocked()
	if err != nil {
		a.linkKinds[idx] = previous
	}
	a.mu.Unlock()
	if err != nil {
		return atlas.LinkKind{}, fmt.Errorf("save link kind: %w", err)
	}
	dataevent.Emit("atlas", lk.ID)
	return lk, nil
}

// DeleteLinkKind removes a LinkKind, blocked while any Link still
// references it -- same no-orphaning rule as DeleteKind.
func (a *AtlasService) DeleteLinkKind(id string) error {
	a.mu.Lock()
	idx := a.findLinkKindLocked(id)
	if idx == -1 {
		a.mu.Unlock()
		return fmt.Errorf("no link kind with id %q", id)
	}
	// A link touching a tombstoned card (goal 0093) never blocks
	// LinkKind deletion -- liveLinksLocked already hides it.
	for _, l := range a.liveLinksLocked() {
		if l.LinkKindID == id {
			a.mu.Unlock()
			return fmt.Errorf("link kind %q is still used by a link -- delete it first", id)
		}
	}
	removed := a.linkKinds[idx]
	wasBuiltIn := removed.BuiltIn
	a.linkKinds = append(a.linkKinds[:idx], a.linkKinds[idx+1:]...)
	if wasBuiltIn {
		if err := seeding.RecordTombstone(a.store, id); err != nil {
			a.linkKinds = insertLinkKindAt(a.linkKinds, idx, removed)
			a.mu.Unlock()
			return fmt.Errorf("tombstone deleted link kind %q: %w", id, err)
		}
	}
	err := a.persistLocked()
	if err != nil {
		a.linkKinds = insertLinkKindAt(a.linkKinds, idx, removed)
	}
	a.mu.Unlock()
	if err != nil {
		return fmt.Errorf("save link kind deletion: %w", err)
	}
	dataevent.Emit("atlas", id)
	return nil
}

func insertLinkKindAt(kinds []atlas.LinkKind, idx int, lk atlas.LinkKind) []atlas.LinkKind {
	if idx < 0 || idx > len(kinds) {
		idx = len(kinds)
	}
	kinds = append(kinds, atlas.LinkKind{})
	copy(kinds[idx+1:], kinds[idx:])
	kinds[idx] = lk
	return kinds
}
