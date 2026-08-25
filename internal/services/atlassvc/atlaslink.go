package atlassvc

import (
	"fmt"
	"time"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/seeding"
)

// checkLinkReferencesLocked confirms fromCardID/toCardID/linkKindID
// all name existing entities -- the referential-existence check
// atlas.ValidateLink deliberately leaves to this layer. Caller must
// hold a.mu.
func (a *AtlasService) checkLinkReferencesLocked(fromCardID, toCardID, linkKindID string) error {
	if a.findCardLocked(fromCardID) == -1 {
		return fmt.Errorf("no card with id %q", fromCardID)
	}
	if a.findCardLocked(toCardID) == -1 {
		return fmt.Errorf("no card with id %q", toCardID)
	}
	if a.findLinkKindLocked(linkKindID) == -1 {
		return fmt.Errorf("no link kind with id %q", linkKindID)
	}
	return nil
}

// --- Links ---

func (a *AtlasService) CreateLink(fromCardID, toCardID, linkKindID, label string) (atlas.Link, error) {
	newID := seeding.NewSlugID(label, "link")
	l, err := a.createLinkWithID(newID, fromCardID, toCardID, linkKindID, label)
	// createLinkWithID's own dedupe (goal 0124) returns an EXISTING link
	// unchanged for a repeated (from, to, kind) drag -- l.ID then differs
	// from newID, and recording an undo entry here would wrongly offer
	// to delete a link this call never actually created.
	if err == nil && l.ID == newID {
		a.recordLinkCreateUndo(actorUI, l)
	}
	return l, err
}

// recordLinkCreateUndo is CreateLink/CreateLinkForMCP's shared journal
// call -- DeleteLink hard-deletes (no tombstone, unlike cards/notes/
// objects), so undo/redo both go through createLinkWithID, preserving
// the ORIGINAL id both directions so the pair can alternate freely.
func (a *AtlasService) recordLinkCreateUndo(actor undoActor, l atlas.Link) {
	created := l
	a.recordUndo(actor, "link", created.ID, created.Label,
		func(a *AtlasService) error { return a.DeleteLink(created.ID) },
		func(a *AtlasService) error {
			_, err := a.createLinkWithID(created.ID, created.FromCardID, created.ToCardID, created.LinkKindID, created.Label)
			return err
		},
	)
}

// createLinkWithID is CreateLink's own logic, parameterized on the new
// link's id -- the seam ImportAtlas uses to preserve a caller-supplied
// id (ADR-0036 decision 3), same shape as compositionsvc's
// createWorkflowWithID/configuresvc's createListWithID.
func (a *AtlasService) createLinkWithID(id, fromCardID, toCardID, linkKindID, label string) (atlas.Link, error) {
	l := atlas.Link{
		ID: id, FromCardID: fromCardID, ToCardID: toCardID,
		LinkKindID: linkKindID, Label: label,
	}
	if err := atlas.ValidateLink(l); err != nil {
		return atlas.Link{}, err
	}

	a.mu.Lock()
	if err := a.checkLinkReferencesLocked(fromCardID, toCardID, linkKindID); err != nil {
		a.mu.Unlock()
		return atlas.Link{}, err
	}
	// One relationship per (from, to, kind) -- goal 0124: repeated
	// link-drags between the same pair inflated the count without
	// bound. Idempotent, not an error: the drag UX re-fires freely, so
	// a duplicate returns the existing link unchanged. Reverse
	// direction stays a distinct link deliberately (directional link
	// kinds are legitimate).
	for _, existing := range a.links {
		if existing.FromCardID == fromCardID && existing.ToCardID == toCardID && existing.LinkKindID == linkKindID {
			a.mu.Unlock()
			return existing, nil
		}
	}
	now := time.Now()
	l.CreatedAt, l.UpdatedAt = now, now
	a.links = append(a.links, l)
	// Authoring-while-active (ADR-0041): a link created while a
	// perspective is active joins it. Snapshot first -- a persist
	// failure below must roll this back too.
	previousPerspectives := append([]atlas.Perspective(nil), a.perspectives...)
	a.joinActivePerspectiveWithLinkLocked(l.ID)
	perr := a.persistLocked()
	if perr != nil {
		a.links = a.links[:len(a.links)-1]
		a.perspectives = previousPerspectives
	}
	a.mu.Unlock()
	if perr != nil {
		return atlas.Link{}, fmt.Errorf("save link: %w", perr)
	}
	dataevent.Emit("atlas", l.ID)
	return l, nil
}

func (a *AtlasService) UpdateLink(id, label string) (atlas.Link, error) {
	a.mu.Lock()
	idx := a.findLinkLocked(id)
	if idx == -1 {
		a.mu.Unlock()
		return atlas.Link{}, fmt.Errorf("no link with id %q", id)
	}
	previous := a.links[idx]
	l := previous
	l.Label = label
	l.UpdatedAt = time.Now()
	l.Seed = l.Seed.Touch()
	a.links[idx] = l
	perr := a.persistLocked()
	if perr != nil {
		a.links[idx] = previous
	}
	a.mu.Unlock()
	if perr != nil {
		return atlas.Link{}, fmt.Errorf("save link: %w", perr)
	}
	dataevent.Emit("atlas", l.ID)
	recordScalar(a, actorUI, "link", id, l.Label,
		func(a *AtlasService, v string) error { _, err := a.UpdateLink(id, v); return err },
		previous.Label, label,
	)
	return l, nil
}

// SetLinkKind reassigns an existing link to a different LinkKind --
// the edge menu's own "Change link kind" action (goal 0081 slice A4),
// distinct from UpdateLink above (which only ever touches Label):
// re-typing a drawn link is a different edit than re-wording it, so it
// gets its own referential-existence check against the new kind.
func (a *AtlasService) SetLinkKind(id, linkKindID string) (atlas.Link, error) {
	a.mu.Lock()
	idx := a.findLinkLocked(id)
	if idx == -1 {
		a.mu.Unlock()
		return atlas.Link{}, fmt.Errorf("no link with id %q", id)
	}
	if a.findLinkKindLocked(linkKindID) == -1 {
		a.mu.Unlock()
		return atlas.Link{}, fmt.Errorf("no link kind with id %q", linkKindID)
	}
	previous := a.links[idx]
	l := previous
	l.LinkKindID = linkKindID
	l.UpdatedAt = time.Now()
	l.Seed = l.Seed.Touch()
	a.links[idx] = l
	perr := a.persistLocked()
	if perr != nil {
		a.links[idx] = previous
	}
	a.mu.Unlock()
	if perr != nil {
		return atlas.Link{}, fmt.Errorf("save link: %w", perr)
	}
	dataevent.Emit("atlas", l.ID)
	recordScalar(a, actorUI, "link", id, l.Label,
		func(a *AtlasService, v string) error { _, err := a.SetLinkKind(id, v); return err },
		previous.LinkKindID, linkKindID,
	)
	return l, nil
}

func (a *AtlasService) DeleteLink(id string) error {
	a.mu.Lock()
	idx := a.findLinkLocked(id)
	if idx == -1 {
		a.mu.Unlock()
		return fmt.Errorf("no link with id %q", id)
	}
	removed := a.links[idx]
	wasBuiltIn := removed.BuiltIn
	a.links = append(a.links[:idx], a.links[idx+1:]...)
	if wasBuiltIn {
		if err := seeding.RecordTombstone(a.store, id); err != nil {
			a.links = insertLinkAt(a.links, idx, removed)
			a.mu.Unlock()
			return fmt.Errorf("tombstone deleted link %q: %w", id, err)
		}
	}
	perr := a.persistLocked()
	if perr != nil {
		a.links = insertLinkAt(a.links, idx, removed)
	}
	a.mu.Unlock()
	if perr != nil {
		return fmt.Errorf("save link deletion: %w", perr)
	}
	dataevent.Emit("atlas", id)
	a.recordUndo(actorUI, "link", id, removed.Label,
		func(a *AtlasService) error {
			_, err := a.createLinkWithID(removed.ID, removed.FromCardID, removed.ToCardID, removed.LinkKindID, removed.Label)
			return err
		},
		func(a *AtlasService) error { return a.DeleteLink(id) },
	)
	return nil
}

func insertLinkAt(links []atlas.Link, idx int, l atlas.Link) []atlas.Link {
	if idx < 0 || idx > len(links) {
		idx = len(links)
	}
	links = append(links, atlas.Link{})
	copy(links[idx+1:], links[idx:])
	links[idx] = l
	return links
}

// --- Lens ---

// SetLens persists the per-space lens for containerID: which Kind IDs
// stay hidden when viewing that container's children (ADR-0038's
// density-is-a-lens-choice principle), and the depth/peek toggle (goal
// 0061 slice C -- absorbed here from its previous browser-localStorage
// home). A setting with nothing real in it (no hidden kinds, peek off)
// clears the container's entry rather than storing a no-op one --
// keeps the persisted map from growing entries with no real content.
func (a *AtlasService) SetLens(containerID string, hiddenKindIDs []string, peek bool) error {
	setting := atlas.LensSetting{HiddenKindIDs: hiddenKindIDs, Peek: peek}
	a.mu.Lock()
	previous, had := a.lenses[containerID]
	if setting.IsZero() {
		delete(a.lenses, containerID)
	} else {
		a.lenses[containerID] = setting
	}
	perr := a.persistLocked()
	if perr != nil {
		if had {
			a.lenses[containerID] = previous
		} else {
			delete(a.lenses, containerID)
		}
	}
	a.mu.Unlock()
	if perr != nil {
		return fmt.Errorf("save lens: %w", perr)
	}
	dataevent.Emit("atlas", containerID)
	recordScalar(a, actorUI, "lens", containerID, containerID,
		func(a *AtlasService, s atlas.LensSetting) error {
			return a.SetLens(containerID, s.HiddenKindIDs, s.Peek)
		},
		previous, setting,
	)
	return nil
}

// Lens returns the persisted lens setting for containerID -- the zero
// value (no hidden kinds, peek off) when none is set.
func (a *AtlasService) Lens(containerID string) atlas.LensSetting {
	a.mu.RLock()
	defer a.mu.RUnlock()
	setting := a.lenses[containerID]
	out := atlas.LensSetting{HiddenKindIDs: make([]string, len(setting.HiddenKindIDs)), Peek: setting.Peek}
	copy(out.HiddenKindIDs, setting.HiddenKindIDs)
	return out
}

// dedupeLinks keeps the first link per (from, to, kind) -- the load-
// time self-heal for data inflated before creation enforced
// uniqueness (goal 0124).
func dedupeLinks(links []atlas.Link) []atlas.Link {
	seen := make(map[string]bool, len(links))
	out := links[:0]
	for _, l := range links {
		key := l.FromCardID + "\x00" + l.ToCardID + "\x00" + l.LinkKindID
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, l)
	}
	return out
}
