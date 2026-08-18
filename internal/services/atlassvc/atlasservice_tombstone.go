package atlassvc

import (
	"fmt"
	"log/slog"
	"time"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/seeding"
)

// tombstoneGraceWindow is how long a soft-deleted card/note stays
// recoverable before the boot-time purge removes it for good (goal
// 0093's undo guard) -- long enough to survive an app restart shortly
// after a delete, short enough that storage never accumulates
// indefinitely from entities nobody undid.
const tombstoneGraceWindow = 48 * time.Hour

// TombstoneResult names exactly which ids one DeleteCard/DeleteNote
// call soft-deleted -- DeleteCard populates only CardIDs, DeleteNote
// only NoteIDs, so the frontend's undo toast can pass this straight
// back to UndoDelete without re-deriving what it touched. LinksRemoved
// and ChildrenPromoted are the delete's blast radius, counted against
// the state immediately BEFORE this call's own tombstone lands: links
// that were visible and now touch a tombstoned endpoint, and direct
// live children (cards + notes) whose effective parent is about to
// shift past this card. Both stay zero for DeleteNote -- a note can
// carry neither a link endpoint nor a child.
type TombstoneResult struct {
	CardIDs          []string
	NoteIDs          []string
	LinksRemoved     int
	ChildrenPromoted int
}

// liveLinkTouchCountLocked counts currently-live links (both endpoints
// live) that touch cardID -- the number of links about to become
// hidden if cardID is tombstoned next. Caller must hold a.mu.
func (a *AtlasService) liveLinkTouchCountLocked(cardID string) int {
	tombstoned := make(map[string]bool)
	for _, c := range a.cards {
		if !c.DeletedAt.IsZero() {
			tombstoned[c.ID] = true
		}
	}
	n := 0
	for _, l := range a.links {
		if tombstoned[l.FromCardID] || tombstoned[l.ToCardID] {
			continue
		}
		if l.FromCardID == cardID || l.ToCardID == cardID {
			n++
		}
	}
	return n
}

// directLiveChildCountLocked counts live cards and notes whose stored
// ParentID is exactly cardID -- the direct children about to be
// virtually promoted to cardID's own effective parent. Caller must
// hold a.mu.
func (a *AtlasService) directLiveChildCountLocked(cardID string) int {
	n := 0
	for _, c := range a.cards {
		if c.ParentID == cardID && c.DeletedAt.IsZero() {
			n++
		}
	}
	for _, nt := range a.notes {
		if nt.ParentID == cardID && nt.DeletedAt.IsZero() {
			n++
		}
	}
	return n
}

// liveCardsLocked returns every non-tombstoned card, each carrying its
// EFFECTIVE ParentID (atlas.EffectiveParentID) rather than the raw
// stored one -- a live child of a tombstoned container renders under
// its nearest live ancestor without any data rewrite until purge.
// Caller must hold a.mu.
func (a *AtlasService) liveCardsLocked() []atlas.Card {
	byID := a.cardsByIDLocked()
	out := make([]atlas.Card, 0, len(a.cards))
	for _, c := range a.cards {
		if !c.DeletedAt.IsZero() {
			continue
		}
		c.ParentID = atlas.EffectiveParentID(byID, c.ParentID)
		out = append(out, c)
	}
	return out
}

// liveNotesLocked is liveCardsLocked's own counterpart for Notes --
// same tombstone-exclusion + effective-parent resolution. Caller must
// hold a.mu.
func (a *AtlasService) liveNotesLocked() []atlas.Note {
	byID := a.cardsByIDLocked()
	out := make([]atlas.Note, 0, len(a.notes))
	for _, n := range a.notes {
		if !n.DeletedAt.IsZero() {
			continue
		}
		n.ParentID = atlas.EffectiveParentID(byID, n.ParentID)
		out = append(out, n)
	}
	return out
}

// liveLinksLocked returns every link whose endpoints are BOTH live
// cards -- a link touching a tombstoned card must not render as a
// dangling edge to a card no other read surface shows anymore. The
// underlying Link row is never touched by a card delete/undo, so
// nothing needs restoring here: once its tombstoned endpoint comes
// back (UndoDelete) or both endpoints stay live, the link simply
// reappears. Caller must hold a.mu.
func (a *AtlasService) liveLinksLocked() []atlas.Link {
	tombstoned := make(map[string]bool)
	for _, c := range a.cards {
		if !c.DeletedAt.IsZero() {
			tombstoned[c.ID] = true
		}
	}
	out := make([]atlas.Link, 0, len(a.links))
	for _, l := range a.links {
		if tombstoned[l.FromCardID] || tombstoned[l.ToCardID] {
			continue
		}
		out = append(out, l)
	}
	return out
}

// DeleteCard soft-deletes a card (goal 0093's quick-delete-with-undo
// guard): stamps DeletedAt and leaves ParentID/children untouched --
// no data rewrite happens until the boot-time purge; every live child
// simply resolves its effective parent (atlas.EffectiveParentID) past
// this tombstone in the meantime, so undo needs nothing more than
// clearing the stamp back. A built-in card's seed tombstone is
// recorded immediately, same timing the previous hard-delete already
// used, since a deleted built-in must not be topped up by reconcile
// while it's hidden.
func (a *AtlasService) DeleteCard(id string) (TombstoneResult, error) {
	a.mu.Lock()
	idx := a.findCardLocked(id)
	if idx == -1 {
		a.mu.Unlock()
		return TombstoneResult{}, fmt.Errorf("no card with id %q", id)
	}
	if !a.cards[idx].DeletedAt.IsZero() {
		a.mu.Unlock()
		return TombstoneResult{}, fmt.Errorf("card %q is already deleted", id)
	}
	previous := a.cards[idx]
	wasBuiltIn := previous.BuiltIn
	linksRemoved := a.liveLinkTouchCountLocked(id)
	childrenPromoted := a.directLiveChildCountLocked(id)
	now := time.Now()
	a.cards[idx].DeletedAt = now
	a.cards[idx].UpdatedAt = now

	if wasBuiltIn {
		if err := seeding.RecordTombstone(a.store, id); err != nil {
			a.cards[idx] = previous
			a.mu.Unlock()
			return TombstoneResult{}, fmt.Errorf("tombstone deleted card %q: %w", id, err)
		}
	}
	// A perspective SCOPED to this card (its own "space") is deleted
	// outright (ADR-0041's no-tombstone posture) even though the card
	// itself only soft-deletes: a view over a space that no longer
	// exists has nothing left to be a view of.
	previousPerspectives := append([]atlas.Perspective(nil), a.perspectives...)
	kept := a.perspectives[:0]
	for _, p := range a.perspectives {
		if p.SpaceID != id {
			kept = append(kept, p)
		}
	}
	a.perspectives = kept
	perr := a.persistLocked()
	if perr != nil {
		a.cards[idx] = previous
		a.perspectives = previousPerspectives
	}
	a.mu.Unlock()
	if perr != nil {
		return TombstoneResult{}, fmt.Errorf("save card deletion: %w", perr)
	}
	dataevent.Emit("atlas", id)
	return TombstoneResult{CardIDs: []string{id}, LinksRemoved: linksRemoved, ChildrenPromoted: childrenPromoted}, nil
}

// DeleteNote soft-deletes a note -- same tombstone contract as
// DeleteCard, minus the seed-tombstone bookkeeping (notes carry no
// seed provenance).
func (a *AtlasService) DeleteNote(id string) (TombstoneResult, error) {
	a.mu.Lock()
	idx := a.findNoteLocked(id)
	if idx == -1 {
		a.mu.Unlock()
		return TombstoneResult{}, fmt.Errorf("no note with id %q", id)
	}
	if !a.notes[idx].DeletedAt.IsZero() {
		a.mu.Unlock()
		return TombstoneResult{}, fmt.Errorf("note %q is already deleted", id)
	}
	previous := a.notes[idx]
	now := time.Now()
	a.notes[idx].DeletedAt = now
	a.notes[idx].UpdatedAt = now
	perr := a.persistLocked()
	if perr != nil {
		a.notes[idx] = previous
	}
	a.mu.Unlock()
	if perr != nil {
		return TombstoneResult{}, fmt.Errorf("save note deletion: %w", perr)
	}
	dataevent.Emit("atlas", id)
	return TombstoneResult{NoteIDs: []string{id}}, nil
}

// UndoDelete reverses one or more DeleteCard/DeleteNote calls: clears
// DeletedAt on exactly the ids named (a no-op for any id that's no
// longer tombstoned, e.g. already purged) and clears a built-in
// card's seed tombstone too, so top-up seeding can reach it again.
// cardIDs/noteIDs are the exact TombstoneResult(s) the original
// delete call(s) returned.
func (a *AtlasService) UndoDelete(cardIDs []string, noteIDs []string) error {
	a.mu.Lock()
	previousCards := make([]atlas.Card, len(a.cards))
	copy(previousCards, a.cards)
	previousNotes := make([]atlas.Note, len(a.notes))
	copy(previousNotes, a.notes)

	now := time.Now()
	var clearedBuiltInIDs []string
	for _, id := range cardIDs {
		idx := a.findCardLocked(id)
		if idx == -1 || a.cards[idx].DeletedAt.IsZero() {
			continue
		}
		a.cards[idx].DeletedAt = time.Time{}
		a.cards[idx].UpdatedAt = now
		if a.cards[idx].BuiltIn {
			clearedBuiltInIDs = append(clearedBuiltInIDs, id)
		}
	}
	for _, id := range noteIDs {
		idx := a.findNoteLocked(id)
		if idx == -1 || a.notes[idx].DeletedAt.IsZero() {
			continue
		}
		a.notes[idx].DeletedAt = time.Time{}
		a.notes[idx].UpdatedAt = now
	}

	perr := a.persistLocked()
	if perr != nil {
		a.cards = previousCards
		a.notes = previousNotes
	}
	a.mu.Unlock()
	if perr != nil {
		return fmt.Errorf("save undo delete: %w", perr)
	}
	for _, id := range clearedBuiltInIDs {
		if err := seeding.ClearTombstone(a.store, id); err != nil {
			slog.Error("failed to clear seed tombstone on undo delete", "id", id, "error", err)
		}
	}
	for _, id := range cardIDs {
		dataevent.Emit("atlas", id)
	}
	for _, id := range noteIDs {
		dataevent.Emit("atlas", id)
	}
	return nil
}

// purgeTombstonesLocked hard-removes every card/note tombstoned more
// than tombstoneGraceWindow before now -- called once from restore()
// at boot, never a background timer. A purged card's surviving
// children (cards and notes) are re-parented for REAL to their
// effective parent first (atlas.EffectiveParentID, resolved against
// the full pre-purge card set, so a chain of several tombstoned
// ancestors collapses to the nearest live one in one step); a purged
// card's own links go with it. Caller must hold a.mu, or call it
// during construction before the service is shared across goroutines
// (restore's own case).
func (a *AtlasService) purgeTombstonesLocked(now time.Time) bool {
	cutoff := now.Add(-tombstoneGraceWindow)
	byID := a.cardsByIDLocked()

	purgeCards := make(map[string]bool)
	for _, c := range a.cards {
		if !c.DeletedAt.IsZero() && c.DeletedAt.Before(cutoff) {
			purgeCards[c.ID] = true
		}
	}
	purgeNotes := make(map[string]bool)
	for _, n := range a.notes {
		if !n.DeletedAt.IsZero() && n.DeletedAt.Before(cutoff) {
			purgeNotes[n.ID] = true
		}
	}
	if len(purgeCards) == 0 && len(purgeNotes) == 0 {
		return false
	}

	for i := range a.cards {
		if purgeCards[a.cards[i].ID] {
			continue
		}
		if a.cards[i].ParentID != "" && purgeCards[a.cards[i].ParentID] {
			a.cards[i].ParentID = atlas.EffectiveParentID(byID, a.cards[i].ParentID)
			a.cards[i].UpdatedAt = now
		}
	}
	for i := range a.notes {
		if purgeNotes[a.notes[i].ID] {
			continue
		}
		if a.notes[i].ParentID != "" && purgeCards[a.notes[i].ParentID] {
			a.notes[i].ParentID = atlas.EffectiveParentID(byID, a.notes[i].ParentID)
			a.notes[i].UpdatedAt = now
		}
	}

	keptCards := a.cards[:0]
	for _, c := range a.cards {
		if !purgeCards[c.ID] {
			keptCards = append(keptCards, c)
		}
	}
	a.cards = keptCards

	keptNotes := a.notes[:0]
	for _, n := range a.notes {
		if !purgeNotes[n.ID] {
			keptNotes = append(keptNotes, n)
		}
	}
	a.notes = keptNotes

	if len(purgeCards) > 0 {
		purgedLinkIDs := make(map[string]bool)
		keptLinks := a.links[:0]
		for _, l := range a.links {
			if purgeCards[l.FromCardID] || purgeCards[l.ToCardID] {
				purgedLinkIDs[l.ID] = true
				continue
			}
			keptLinks = append(keptLinks, l)
		}
		a.links = keptLinks
		// A hard-purged card/link must never linger as a dangling
		// perspective member (goal 0095) -- membership keeps raw ids
		// while a card is only soft-deleted, but a permanent purge is
		// this pass's one chance to strip them for good.
		a.purgePerspectiveMembersLocked(purgeCards, purgedLinkIDs)
	}
	return true
}
