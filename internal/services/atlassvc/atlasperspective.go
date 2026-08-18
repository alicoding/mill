package atlassvc

import (
	"fmt"
	"slices"
	"time"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/seeding"
)

// --- Perspectives (ADR-0041, goal 0095) ---
//
// A Perspective is a named, ordered view over one space's live card
// set: explicit membership over cards AND links, never derived. Zero
// Perspectives over a space is the default "everything" view -- no
// migration, no behavior change. Delete is immediate (no tombstone/
// undo lifecycle in v1, cheap to recreate); referential cleanup for a
// deleted perspective is the session's own read-time degrade
// (AtlasSession) plus purgeTombstonesLocked's member-set stripping,
// not a bespoke path here.

// Perspectives returns every perspective across every space -- the
// frontend/caller scopes by SpaceID (goal 0095's slice-1 read model
// mirrors Kinds()/LinkKinds()'s own "return everything, caller
// filters" shape).
func (a *AtlasService) Perspectives() []atlas.Perspective {
	a.mu.RLock()
	defer a.mu.RUnlock()
	out := make([]atlas.Perspective, len(a.perspectives))
	copy(out, a.perspectives)
	return out
}

// CreatePerspective makes a new Perspective over spaceID ("" for the
// true root), appended at the end of that space's own ordered set.
func (a *AtlasService) CreatePerspective(spaceID, name, description string) (atlas.Perspective, error) {
	return a.createPerspectiveWithID("", spaceID, name, description, -1, nil, nil)
}

// createPerspectiveWithID is CreatePerspective's own logic,
// parameterized on the new perspective's id, Order, and initial
// membership -- the seam ImportAtlas uses to preserve a caller-
// supplied id/order/membership (ADR-0036 decision 3), same shape as
// atlascard.go's createCardWithID. order < 0 auto-assigns "append at
// the end of spaceID's own ordered set" (every ordinary create); id ==
// "" mints a fresh one.
func (a *AtlasService) createPerspectiveWithID(id, spaceID, name, description string, order int, memberCardIDs, memberLinkIDs []string) (atlas.Perspective, error) {
	a.mu.Lock()
	if spaceID != "" && a.findCardLocked(spaceID) == -1 {
		a.mu.Unlock()
		return atlas.Perspective{}, fmt.Errorf("no card with id %q to scope this perspective to", spaceID)
	}
	if id == "" {
		id = seeding.NewSlugID(name, "perspective")
	}
	if order < 0 {
		order = -1
		for _, p := range a.perspectives {
			if p.SpaceID == spaceID && p.Order > order {
				order = p.Order
			}
		}
		order++
	}
	now := time.Now()
	p := atlas.Perspective{
		ID: id, SpaceID: spaceID, Name: name, Description: description, Order: order,
		MemberCardIDs: memberCardIDs, MemberLinkIDs: memberLinkIDs,
		CreatedAt: now, UpdatedAt: now,
	}
	if err := atlas.ValidatePerspective(p, a.cardsByIDLocked()); err != nil {
		a.mu.Unlock()
		return atlas.Perspective{}, err
	}
	a.perspectives = append(a.perspectives, p)
	perr := a.persistLocked()
	if perr != nil {
		a.perspectives = a.perspectives[:len(a.perspectives)-1]
	}
	a.mu.Unlock()
	if perr != nil {
		return atlas.Perspective{}, fmt.Errorf("save perspective: %w", perr)
	}
	dataevent.Emit("atlas", p.ID)
	return p, nil
}

// updatePerspectiveFromImport overwrites an existing perspective's full
// content from an import bundle (ADR-0036 decision 3's "id present and
// known locally -> update in place") -- unlike RenamePerspective, this
// also replaces SpaceID/Order/membership wholesale, since a bundle's
// entry is the complete authored state, not a partial edit.
func (a *AtlasService) updatePerspectiveFromImport(id, spaceID, name, description string, order int, memberCardIDs, memberLinkIDs []string) error {
	a.mu.Lock()
	idx := a.findPerspectiveLocked(id)
	if idx == -1 {
		a.mu.Unlock()
		return fmt.Errorf("no perspective with id %q", id)
	}
	if spaceID != "" && a.findCardLocked(spaceID) == -1 {
		a.mu.Unlock()
		return fmt.Errorf("no card with id %q to scope this perspective to", spaceID)
	}
	previous := a.perspectives[idx]
	p := previous
	p.SpaceID, p.Name, p.Description, p.Order = spaceID, name, description, order
	p.MemberCardIDs, p.MemberLinkIDs = memberCardIDs, memberLinkIDs
	p.UpdatedAt = time.Now()
	p.Seed = p.Seed.Touch()
	if err := atlas.ValidatePerspective(p, a.cardsByIDLocked()); err != nil {
		a.mu.Unlock()
		return err
	}
	a.perspectives[idx] = p
	perr := a.persistLocked()
	if perr != nil {
		a.perspectives[idx] = previous
	}
	a.mu.Unlock()
	if perr != nil {
		return fmt.Errorf("save perspective: %w", perr)
	}
	dataevent.Emit("atlas", id)
	return nil
}

// RenamePerspective replaces a perspective's Name/Description in
// place -- membership/SpaceID/Order move through their own dedicated
// calls (AddToPerspective/RemoveFromPerspective/ReorderPerspective),
// same "one concern per mutator" shape UpdateCard vs. MoveCard takes.
func (a *AtlasService) RenamePerspective(id, name, description string) (atlas.Perspective, error) {
	a.mu.Lock()
	idx := a.findPerspectiveLocked(id)
	if idx == -1 {
		a.mu.Unlock()
		return atlas.Perspective{}, fmt.Errorf("no perspective with id %q", id)
	}
	previous := a.perspectives[idx]
	p := previous
	p.Name, p.Description = name, description
	p.UpdatedAt = time.Now()
	p.Seed = p.Seed.Touch()
	if err := atlas.ValidatePerspective(p, a.cardsByIDLocked()); err != nil {
		a.mu.Unlock()
		return atlas.Perspective{}, err
	}
	a.perspectives[idx] = p
	perr := a.persistLocked()
	if perr != nil {
		a.perspectives[idx] = previous
	}
	a.mu.Unlock()
	if perr != nil {
		return atlas.Perspective{}, fmt.Errorf("save perspective: %w", perr)
	}
	dataevent.Emit("atlas", p.ID)
	return p, nil
}

// ReorderPerspective assigns Order = index within orderedIDs to every
// perspective named -- orderedIDs must name EXACTLY the perspectives
// currently scoped to spaceID, once each (the same "whole ordered set,
// not a partial move" shape a drag-reorder list naturally produces).
func (a *AtlasService) ReorderPerspective(spaceID string, orderedIDs []string) error {
	a.mu.Lock()
	indexByID := make(map[string]int, len(a.perspectives))
	scopedCount := 0
	for i, p := range a.perspectives {
		if p.SpaceID == spaceID {
			indexByID[p.ID] = i
			scopedCount++
		}
	}
	if len(orderedIDs) != scopedCount {
		a.mu.Unlock()
		return fmt.Errorf("reorder must name exactly the %d perspective(s) in space %q, got %d", scopedCount, spaceID, len(orderedIDs))
	}
	seen := make(map[string]bool, len(orderedIDs))
	for _, id := range orderedIDs {
		if _, ok := indexByID[id]; !ok {
			a.mu.Unlock()
			return fmt.Errorf("perspective %q is not in space %q", id, spaceID)
		}
		if seen[id] {
			a.mu.Unlock()
			return fmt.Errorf("perspective %q named twice", id)
		}
		seen[id] = true
	}
	previous := make([]atlas.Perspective, len(a.perspectives))
	copy(previous, a.perspectives)
	now := time.Now()
	for order, id := range orderedIDs {
		idx := indexByID[id]
		a.perspectives[idx].Order = order
		a.perspectives[idx].UpdatedAt = now
		a.perspectives[idx].Seed = a.perspectives[idx].Seed.Touch()
	}
	perr := a.persistLocked()
	if perr != nil {
		a.perspectives = previous
	}
	a.mu.Unlock()
	if perr != nil {
		return fmt.Errorf("save perspective reorder: %w", perr)
	}
	dataevent.Emit("atlas", spaceID)
	return nil
}

// DeletePerspective removes a perspective immediately -- no tombstone/
// undo lifecycle (ADR-0041): cheap to recreate. A session parked on
// this perspective degrades to the everything view the next time
// AtlasSession is read; nothing else references a Perspective's id, so
// there is no further referential cleanup to do here.
func (a *AtlasService) DeletePerspective(id string) error {
	a.mu.Lock()
	idx := a.findPerspectiveLocked(id)
	if idx == -1 {
		a.mu.Unlock()
		return fmt.Errorf("no perspective with id %q", id)
	}
	removed := a.perspectives[idx]
	a.perspectives = append(a.perspectives[:idx], a.perspectives[idx+1:]...)
	perr := a.persistLocked()
	if perr != nil {
		a.perspectives = insertPerspectiveAt(a.perspectives, idx, removed)
	}
	a.mu.Unlock()
	if perr != nil {
		return fmt.Errorf("save perspective deletion: %w", perr)
	}
	dataevent.Emit("atlas", id)
	return nil
}

// DiffPerspectives computes what changed moving from fromID's own
// membership to toID's (goal 0095 slice 3's Compare view): a thin
// bound wrapper over the pure atlas.DiffPerspectives helper, the same
// "expose the domain package's own pure function through a read-only
// accessor" shape Perspectives() itself already takes. Re-parenting is
// deliberately never expressed here -- ADR-0041's own invariant, since
// a card carries exactly one ParentID shared by every perspective.
func (a *AtlasService) DiffPerspectives(fromID, toID string) (atlas.PerspectiveDiff, error) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	fromIdx := a.findPerspectiveLocked(fromID)
	if fromIdx == -1 {
		return atlas.PerspectiveDiff{}, fmt.Errorf("no perspective with id %q", fromID)
	}
	toIdx := a.findPerspectiveLocked(toID)
	if toIdx == -1 {
		return atlas.PerspectiveDiff{}, fmt.Errorf("no perspective with id %q", toID)
	}
	return atlas.DiffPerspectives(a.perspectives[fromIdx], a.perspectives[toIdx]), nil
}

func insertPerspectiveAt(perspectives []atlas.Perspective, idx int, p atlas.Perspective) []atlas.Perspective {
	if idx < 0 || idx > len(perspectives) {
		idx = len(perspectives)
	}
	perspectives = append(perspectives, atlas.Perspective{})
	copy(perspectives[idx+1:], perspectives[idx:])
	perspectives[idx] = p
	return perspectives
}

// --- Membership ---

// AddToPerspective adds cardID to perspectiveID, closed under ancestry
// (ADR-0041): every container between cardID and the perspective's own
// SpaceID joins with it, so a deeply nested card never appears in a
// filtered view floating with no visible container. Rejects a cardID
// that does not actually live inside the perspective's space.
func (a *AtlasService) AddToPerspective(perspectiveID, cardID string) (atlas.Perspective, error) {
	a.mu.Lock()
	idx := a.findPerspectiveLocked(perspectiveID)
	if idx == -1 {
		a.mu.Unlock()
		return atlas.Perspective{}, fmt.Errorf("no perspective with id %q", perspectiveID)
	}
	if a.findCardLocked(cardID) == -1 {
		a.mu.Unlock()
		return atlas.Perspective{}, fmt.Errorf("no card with id %q", cardID)
	}
	previous := a.perspectives[idx]
	chain := atlas.AncestorChain(a.cardsByIDLocked(), cardID, previous.SpaceID)
	if chain == nil {
		a.mu.Unlock()
		return atlas.Perspective{}, fmt.Errorf("card %q is not inside perspective %q's space %q", cardID, perspectiveID, previous.SpaceID)
	}
	p := previous
	for _, id := range chain {
		if !slices.Contains(p.MemberCardIDs, id) {
			p.MemberCardIDs = append(p.MemberCardIDs, id)
		}
	}
	p.UpdatedAt = time.Now()
	p.Seed = p.Seed.Touch()
	a.perspectives[idx] = p
	perr := a.persistLocked()
	if perr != nil {
		a.perspectives[idx] = previous
	}
	a.mu.Unlock()
	if perr != nil {
		return atlas.Perspective{}, fmt.Errorf("save perspective membership: %w", perr)
	}
	dataevent.Emit("atlas", perspectiveID)
	return p, nil
}

// RemoveFromPerspective removes cardID from perspectiveID, cascaded to
// every member descendant cardID currently contains (ADR-0041): a
// member left behind after its own container drops out of a view would
// render with no visible parent context.
func (a *AtlasService) RemoveFromPerspective(perspectiveID, cardID string) (atlas.Perspective, error) {
	a.mu.Lock()
	idx := a.findPerspectiveLocked(perspectiveID)
	if idx == -1 {
		a.mu.Unlock()
		return atlas.Perspective{}, fmt.Errorf("no perspective with id %q", perspectiveID)
	}
	previous := a.perspectives[idx]
	remove := atlas.DescendantsAndSelf(a.cardsByIDLocked(), cardID)
	p := previous
	kept := make([]string, 0, len(p.MemberCardIDs))
	for _, id := range p.MemberCardIDs {
		if !remove[id] {
			kept = append(kept, id)
		}
	}
	p.MemberCardIDs = kept
	p.UpdatedAt = time.Now()
	p.Seed = p.Seed.Touch()
	a.perspectives[idx] = p
	perr := a.persistLocked()
	if perr != nil {
		a.perspectives[idx] = previous
	}
	a.mu.Unlock()
	if perr != nil {
		return atlas.Perspective{}, fmt.Errorf("save perspective membership: %w", perr)
	}
	dataevent.Emit("atlas", perspectiveID)
	return p, nil
}

// --- Authoring-while-active (ADR-0041) ---

// joinActivePerspectiveWithCardLocked adds cardID -- and, per the
// ancestry-closure rule, every container between it and the
// perspective's own SpaceID -- to the session's ACTIVE perspective,
// when one is set, still exists, and cardID actually lives inside that
// perspective's space. A silent no-op otherwise (including while no
// perspective is active, the default everything view, or cardID falls
// outside the active perspective's space entirely -- e.g. a workflow-
// authored root-level card while a nested perspective is active).
// Caller must hold a.mu; the caller's own persistLocked/dataevent.Emit
// covers this mutation too, so authoring stays one operation, one
// emit.
func (a *AtlasService) joinActivePerspectiveWithCardLocked(cardID string) {
	if a.session.ActivePerspectiveID == "" {
		return
	}
	idx := a.findPerspectiveLocked(a.session.ActivePerspectiveID)
	if idx == -1 {
		return
	}
	p := &a.perspectives[idx]
	chain := atlas.AncestorChain(a.cardsByIDLocked(), cardID, p.SpaceID)
	if chain == nil {
		return
	}
	changed := false
	for _, id := range chain {
		if !slices.Contains(p.MemberCardIDs, id) {
			p.MemberCardIDs = append(p.MemberCardIDs, id)
			changed = true
		}
	}
	if changed {
		p.UpdatedAt = time.Now()
		p.Seed = p.Seed.Touch()
	}
}

// joinActivePerspectiveWithLinkLocked adds linkID to the session's
// ACTIVE perspective, when one is set and still exists -- the link's
// own counterpart to joinActivePerspectiveWithCardLocked. A link's
// endpoints are joined independently (drawing a link normally happens
// between two cards already visible, i.e. already members); this call
// only ever adds the link entity itself. Caller must hold a.mu.
func (a *AtlasService) joinActivePerspectiveWithLinkLocked(linkID string) {
	if a.session.ActivePerspectiveID == "" {
		return
	}
	idx := a.findPerspectiveLocked(a.session.ActivePerspectiveID)
	if idx == -1 {
		return
	}
	p := &a.perspectives[idx]
	if !slices.Contains(p.MemberLinkIDs, linkID) {
		p.MemberLinkIDs = append(p.MemberLinkIDs, linkID)
		p.UpdatedAt = time.Now()
		p.Seed = p.Seed.Touch()
	}
}

// --- Purge integration ---

// purgePerspectiveMembersLocked strips every id in purgedCardIDs from
// every perspective's MemberCardIDs, and every id in purgedLinkIDs from
// every perspective's MemberLinkIDs -- purgeTombstonesLocked's own
// pass (goal 0095): a hard-purged card/link must never linger as a
// dangling member no create/remove path will ever clean up again.
// Caller must hold a.mu.
func (a *AtlasService) purgePerspectiveMembersLocked(purgedCardIDs, purgedLinkIDs map[string]bool) {
	if len(purgedCardIDs) == 0 && len(purgedLinkIDs) == 0 {
		return
	}
	for i := range a.perspectives {
		if len(purgedCardIDs) > 0 {
			a.perspectives[i].MemberCardIDs = removeIDs(a.perspectives[i].MemberCardIDs, purgedCardIDs)
		}
		if len(purgedLinkIDs) > 0 {
			a.perspectives[i].MemberLinkIDs = removeIDs(a.perspectives[i].MemberLinkIDs, purgedLinkIDs)
		}
	}
}

// removeIDs returns ids with every id present in remove dropped,
// preserving order -- in-place (ids' own backing array is reused, the
// same keptCards/keptLinks style purgeTombstonesLocked already uses).
func removeIDs(ids []string, remove map[string]bool) []string {
	out := ids[:0]
	for _, id := range ids {
		if !remove[id] {
			out = append(out, id)
		}
	}
	return out
}
