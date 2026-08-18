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
	return a.createLinkWithID(seeding.NewSlugID(label, "link"), fromCardID, toCardID, linkKindID, label)
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
