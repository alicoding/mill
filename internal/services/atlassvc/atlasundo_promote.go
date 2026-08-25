package atlassvc

import (
	"fmt"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/services/dataevent"
)

// Promote's own inverse (ADR-0044 Scope: "promote is create-card +
// tombstone-source, both invertible") -- PromoteNote/PromoteBoardObject
// hard-remove the source (no tombstone) and mint a new Card, so their
// undo can't reuse the UndoDelete door the create/delete family shares.
// demoteCardToNote/demoteCardToObject restore the EXACT pre-promotion
// note/object struct (same id, same fields) and remove the promoted
// card; repromoteNoteToCard/repromoteObjectToCard are their own
// mirror-image redo (restore the EXACT promoted card struct, remove the
// note/object again). Both directions are pure struct swaps -- no new
// id is ever minted on either side, so undo/redo can alternate any
// number of times without drift.

//nolint:dupl // demoteCardToNote/repromoteNoteToCard mirror demoteCardToObject/repromoteObjectToCard by design (same struct-swap shape across Note vs BoardObject) -- a shared generic swap is a larger refactor than this slice's scope
func (a *AtlasService) demoteCardToNote(cardID string, note atlas.Note) error {
	a.mu.Lock()
	idx := a.findCardLocked(cardID)
	if idx == -1 {
		a.mu.Unlock()
		return fmt.Errorf("no card with id %q", cardID)
	}
	previousCards := append([]atlas.Card(nil), a.cards...)
	previousNotes := append([]atlas.Note(nil), a.notes...)
	a.cards = append(a.cards[:idx], a.cards[idx+1:]...)
	a.notes = append(a.notes, note)
	perr := a.persistLocked()
	if perr != nil {
		a.cards = previousCards
		a.notes = previousNotes
	}
	a.mu.Unlock()
	if perr != nil {
		return fmt.Errorf("save demote: %w", perr)
	}
	dataevent.Emit("atlas", cardID)
	dataevent.Emit("atlas", note.ID)
	return nil
}

func (a *AtlasService) repromoteNoteToCard(noteID string, card atlas.Card) error {
	a.mu.Lock()
	idx := a.findNoteLocked(noteID)
	if idx == -1 {
		a.mu.Unlock()
		return fmt.Errorf("no note with id %q", noteID)
	}
	previousCards := append([]atlas.Card(nil), a.cards...)
	previousNotes := append([]atlas.Note(nil), a.notes...)
	a.notes = append(a.notes[:idx], a.notes[idx+1:]...)
	a.cards = append(a.cards, card)
	perr := a.persistLocked()
	if perr != nil {
		a.cards = previousCards
		a.notes = previousNotes
	}
	a.mu.Unlock()
	if perr != nil {
		return fmt.Errorf("save repromote: %w", perr)
	}
	dataevent.Emit("atlas", card.ID)
	dataevent.Emit("atlas", noteID)
	return nil
}

//nolint:dupl // mirrors demoteCardToNote/repromoteNoteToCard by design -- see that pair's own nolint comment
func (a *AtlasService) demoteCardToObject(cardID string, obj atlas.BoardObject) error {
	a.mu.Lock()
	idx := a.findCardLocked(cardID)
	if idx == -1 {
		a.mu.Unlock()
		return fmt.Errorf("no card with id %q", cardID)
	}
	previousCards := append([]atlas.Card(nil), a.cards...)
	previousObjects := append([]atlas.BoardObject(nil), a.objects...)
	a.cards = append(a.cards[:idx], a.cards[idx+1:]...)
	a.objects = append(a.objects, obj)
	perr := a.persistLocked()
	if perr != nil {
		a.cards = previousCards
		a.objects = previousObjects
	}
	a.mu.Unlock()
	if perr != nil {
		return fmt.Errorf("save demote: %w", perr)
	}
	dataevent.Emit("atlas", cardID)
	dataevent.Emit("atlas", obj.ID)
	return nil
}

func (a *AtlasService) repromoteObjectToCard(objectID string, card atlas.Card) error {
	a.mu.Lock()
	idx := a.findObjectLocked(objectID)
	if idx == -1 {
		a.mu.Unlock()
		return fmt.Errorf("no board object with id %q", objectID)
	}
	previousCards := append([]atlas.Card(nil), a.cards...)
	previousObjects := append([]atlas.BoardObject(nil), a.objects...)
	a.objects = append(a.objects[:idx], a.objects[idx+1:]...)
	a.cards = append(a.cards, card)
	perr := a.persistLocked()
	if perr != nil {
		a.cards = previousCards
		a.objects = previousObjects
	}
	a.mu.Unlock()
	if perr != nil {
		return fmt.Errorf("save repromote: %w", perr)
	}
	dataevent.Emit("atlas", card.ID)
	dataevent.Emit("atlas", objectID)
	return nil
}
