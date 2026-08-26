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

// TombstoneResult names exactly which ids one DeleteCard/DeleteNote/
// DeleteBoardObject call soft-deleted -- DeleteCard populates only
// CardIDs, DeleteNote only NoteIDs, DeleteBoardObject only ObjectIDs,
// so the frontend's undo toast can pass this straight back to
// UndoDelete without re-deriving what it touched. LinksRemoved and
// ChildrenPromoted are the delete's blast radius, counted against the
// state immediately BEFORE this call's own tombstone lands: links that
// were visible and now touch a tombstoned endpoint, and direct live
// children (cards + notes) whose effective parent is about to shift
// past this card. Both stay zero for DeleteNote/DeleteBoardObject -- a
// note or board object can carry neither a link endpoint nor a child.
type TombstoneResult struct {
	CardIDs          []string
	NoteIDs          []string
	ObjectIDs        []string
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

// directLiveChildCountLocked counts live cards, notes, and board
// objects whose stored ParentID is exactly cardID -- the direct
// children about to be virtually promoted to cardID's own effective
// parent. Caller must hold a.mu.
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
	for _, o := range a.objects {
		if o.ParentID == cardID && o.DeletedAt.IsZero() {
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

// liveObjectsLocked is liveCardsLocked's own counterpart for board
// objects (goal 0179/0180) -- same tombstone-exclusion + effective-
// parent resolution. Caller must hold a.mu.
func (a *AtlasService) liveObjectsLocked() []atlas.BoardObject {
	byID := a.cardsByIDLocked()
	out := make([]atlas.BoardObject, 0, len(a.objects))
	for _, o := range a.objects {
		if !o.DeletedAt.IsZero() {
			continue
		}
		o.ParentID = atlas.EffectiveParentID(byID, o.ParentID)
		out = append(out, o)
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
	a.disarmMirrorWatch(id)
	a.recordUndo(actorUI, "card", id, previous.Title,
		func(a *AtlasService) error { return a.UndoDelete([]string{id}, nil, nil) },
		func(a *AtlasService) error { _, err := a.DeleteCard(id); return err },
	)
	return TombstoneResult{CardIDs: []string{id}, LinksRemoved: linksRemoved, ChildrenPromoted: childrenPromoted}, nil
}

// DeleteNote soft-deletes a note -- same tombstone contract as
// DeleteCard, minus the seed-tombstone bookkeeping (notes carry no
// seed provenance).
func (a *AtlasService) DeleteNote(id string) (TombstoneResult, error) {
	a.mu.Lock()
	var label string
	if idx := a.findNoteLocked(id); idx != -1 {
		label = a.notes[idx].Text
	}
	err := softDeleteEntityLocked(a, a.notes, id, "note", func() int { return a.findNoteLocked(id) },
		func(n atlas.Note) time.Time { return n.DeletedAt },
		func(n *atlas.Note, t time.Time) { n.DeletedAt = t; n.UpdatedAt = t })
	a.mu.Unlock()
	if err != nil {
		return TombstoneResult{}, err
	}
	dataevent.Emit("atlas", id)
	a.recordUndo(actorUI, "note", id, label,
		func(a *AtlasService) error { return a.UndoDelete(nil, []string{id}, nil) },
		func(a *AtlasService) error { _, err := a.DeleteNote(id); return err },
	)
	return TombstoneResult{NoteIDs: []string{id}}, nil
}

// DeleteBoardObject soft-deletes a board object (goal 0179/0180) --
// same tombstone contract as DeleteCard's own seed-tombstone bookkeeping
// (goal 0223 gives BoardObject the same BuiltIn/Seed provenance Card
// already carries), minus DeleteCard's link/child blast radius (a
// board object can be neither a link endpoint nor a container).
//
//nolint:dupl // same wasBuiltIn-tombstone-then-persist shape as DeleteCard -- a shared generic delete is a larger refactor than this goal's scope
func (a *AtlasService) DeleteBoardObject(id string) (TombstoneResult, error) {
	a.mu.Lock()
	idx := a.findObjectLocked(id)
	if idx == -1 {
		a.mu.Unlock()
		return TombstoneResult{}, fmt.Errorf("no board object with id %q", id)
	}
	if !a.objects[idx].DeletedAt.IsZero() {
		a.mu.Unlock()
		return TombstoneResult{}, fmt.Errorf("board object %q is already deleted", id)
	}
	previous := a.objects[idx]
	wasBuiltIn := previous.BuiltIn
	now := time.Now()
	a.objects[idx].DeletedAt = now
	a.objects[idx].UpdatedAt = now
	if wasBuiltIn {
		if err := seeding.RecordTombstone(a.store, id); err != nil {
			a.objects[idx] = previous
			a.mu.Unlock()
			return TombstoneResult{}, fmt.Errorf("tombstone deleted board object %q: %w", id, err)
		}
	}
	perr := a.persistLocked()
	if perr != nil {
		a.objects[idx] = previous
	}
	a.mu.Unlock()
	if perr != nil {
		return TombstoneResult{}, fmt.Errorf("save board object deletion: %w", perr)
	}
	dataevent.Emit("atlas", id)
	a.disarmMirrorWatch(id)
	a.recordUndo(actorUI, "object", id, previous.Kind,
		func(a *AtlasService) error { return a.UndoDelete(nil, nil, []string{id}) },
		func(a *AtlasService) error { _, err := a.DeleteBoardObject(id); return err },
	)
	return TombstoneResult{ObjectIDs: []string{id}}, nil
}

// UndoDelete reverses one or more DeleteCard/DeleteNote/
// DeleteBoardObject calls: clears DeletedAt on exactly the ids named (a
// no-op for any id that's no longer tombstoned, e.g. already purged)
// and clears a built-in card's or board object's seed tombstone too, so
// top-up seeding can reach it again. cardIDs/noteIDs/objectIDs are the
// exact TombstoneResult(s) the original delete call(s) returned.
func (a *AtlasService) UndoDelete(cardIDs []string, noteIDs []string, objectIDs []string) error {
	a.mu.Lock()
	previousCards := append([]atlas.Card(nil), a.cards...)
	previousNotes := append([]atlas.Note(nil), a.notes...)
	previousObjects := append([]atlas.BoardObject(nil), a.objects...)

	clearedBuiltInIDs := a.restoreCardTombstonesLocked(cardIDs)
	restoreTombstonesLocked(a.notes, noteIDs, a.findNoteLocked,
		func(n atlas.Note) time.Time { return n.DeletedAt },
		func(n *atlas.Note, t time.Time) { n.DeletedAt = time.Time{}; n.UpdatedAt = t })
	clearedBuiltInIDs = append(clearedBuiltInIDs, a.restoreObjectTombstonesLocked(objectIDs)...)

	perr := a.persistLocked()
	if perr != nil {
		a.cards = previousCards
		a.notes = previousNotes
		a.objects = previousObjects
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
	emitUndoDeleteEvents(cardIDs, noteIDs, objectIDs)
	return nil
}

// restoreCardTombstonesLocked is UndoDelete's own card half: same
// shape as restoreTombstonesLocked, plus the built-in-seed bookkeeping
// only a card carries -- returns the ids that need their seed
// tombstone cleared too (so top-up seeding can reach them again).
// Caller must already hold a.mu.
func (a *AtlasService) restoreCardTombstonesLocked(cardIDs []string) []string {
	var clearedBuiltInIDs []string
	now := time.Now()
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
	return clearedBuiltInIDs
}

// restoreObjectTombstonesLocked is restoreCardTombstonesLocked's own
// board-object twin (goal 0223 gives BoardObject the same seed
// provenance Card already carries). Caller must already hold a.mu.
func (a *AtlasService) restoreObjectTombstonesLocked(objectIDs []string) []string {
	var clearedBuiltInIDs []string
	now := time.Now()
	for _, id := range objectIDs {
		idx := a.findObjectLocked(id)
		if idx == -1 || a.objects[idx].DeletedAt.IsZero() {
			continue
		}
		a.objects[idx].DeletedAt = time.Time{}
		a.objects[idx].UpdatedAt = now
		if a.objects[idx].BuiltIn {
			clearedBuiltInIDs = append(clearedBuiltInIDs, id)
		}
	}
	return clearedBuiltInIDs
}

// emitUndoDeleteEvents fires the live-sync event for every restored id
// across all three entity families, in one place.
func emitUndoDeleteEvents(cardIDs, noteIDs, objectIDs []string) {
	for _, id := range cardIDs {
		dataevent.Emit("atlas", id)
	}
	for _, id := range noteIDs {
		dataevent.Emit("atlas", id)
	}
	for _, id := range objectIDs {
		dataevent.Emit("atlas", id)
	}
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
	purgeObjects := make(map[string]bool)
	for _, o := range a.objects {
		if !o.DeletedAt.IsZero() && o.DeletedAt.Before(cutoff) {
			purgeObjects[o.ID] = true
		}
	}
	if len(purgeCards) == 0 && len(purgeNotes) == 0 && len(purgeObjects) == 0 {
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
	for i := range a.objects {
		if purgeObjects[a.objects[i].ID] {
			continue
		}
		if a.objects[i].ParentID != "" && purgeCards[a.objects[i].ParentID] {
			a.objects[i].ParentID = atlas.EffectiveParentID(byID, a.objects[i].ParentID)
			a.objects[i].UpdatedAt = now
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

	keptObjects := a.objects[:0]
	for _, o := range a.objects {
		if !purgeObjects[o.ID] {
			keptObjects = append(keptObjects, o)
		}
	}
	a.objects = keptObjects

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
