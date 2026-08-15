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
	l := atlas.Link{
		ID: seeding.NewSlugID(label, "link"), FromCardID: fromCardID, ToCardID: toCardID,
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
	perr := a.persistLocked()
	if perr != nil {
		a.links = a.links[:len(a.links)-1]
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
// density-is-a-lens-choice principle). An empty hiddenKindIDs clears
// the lens for that container rather than storing an empty slice --
// keeps the persisted map from growing entries with no real content.
func (a *AtlasService) SetLens(containerID string, hiddenKindIDs []string) error {
	a.mu.Lock()
	previous, had := a.lenses[containerID]
	if len(hiddenKindIDs) == 0 {
		delete(a.lenses, containerID)
	} else {
		a.lenses[containerID] = hiddenKindIDs
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

// Lens returns the hidden Kind IDs for containerID, or nil if no lens
// is set.
func (a *AtlasService) Lens(containerID string) []string {
	a.mu.RLock()
	defer a.mu.RUnlock()
	hidden := a.lenses[containerID]
	out := make([]string, len(hidden))
	copy(out, hidden)
	return out
}
