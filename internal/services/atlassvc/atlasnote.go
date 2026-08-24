package atlassvc

import (
	"fmt"
	"time"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/seeding"
)

// --- Notes (goal 0081 slice A1) ---
//
// A Note is a quick-capture annotation, structurally excluded from
// every semantic mechanism a Card carries: no KindID, no Fields, no
// links, no BuiltIn/Seed provenance -- its own collection, never
// touched by reconcileBuiltIns. PromoteNote below is the one path from
// a Note to a Card.

// CreateNote makes a new Note, optionally inside parentID ("" for
// root-level) -- same containment-existence check CreateCard runs.
func (a *AtlasService) CreateNote(text string, pos atlas.Position, parentID string) (atlas.Note, error) {
	a.mu.Lock()
	if parentID != "" && a.findCardLocked(parentID) == -1 {
		a.mu.Unlock()
		return atlas.Note{}, fmt.Errorf("no card with id %q to contain this note", parentID)
	}
	now := time.Now()
	n := atlas.Note{
		ID: seeding.NewSlugID(text, "note"), Text: text, Position: pos, ParentID: parentID,
		CreatedAt: now, UpdatedAt: now,
	}
	if err := atlas.ValidateNote(n); err != nil {
		a.mu.Unlock()
		return atlas.Note{}, err
	}
	a.notes = append(a.notes, n)
	perr := a.persistLocked()
	if perr != nil {
		a.notes = a.notes[:len(a.notes)-1]
	}
	a.mu.Unlock()
	if perr != nil {
		return atlas.Note{}, fmt.Errorf("save note: %w", perr)
	}
	dataevent.Emit("atlas", n.ID)
	return n, nil
}

// UpdateNoteText replaces a Note's own text in place.
func (a *AtlasService) UpdateNoteText(id, text string) (atlas.Note, error) {
	a.mu.Lock()
	idx := a.findNoteLocked(id)
	if idx == -1 {
		a.mu.Unlock()
		return atlas.Note{}, fmt.Errorf("no note with id %q", id)
	}
	previous := a.notes[idx]
	n := previous
	n.Text = text
	n.UpdatedAt = time.Now()
	if err := atlas.ValidateNote(n); err != nil {
		a.mu.Unlock()
		return atlas.Note{}, err
	}
	a.notes[idx] = n
	perr := a.persistLocked()
	if perr != nil {
		a.notes[idx] = previous
	}
	a.mu.Unlock()
	if perr != nil {
		return atlas.Note{}, fmt.Errorf("save note: %w", perr)
	}
	dataevent.Emit("atlas", n.ID)
	return n, nil
}

// SetNotePosition updates a note's placement within its parent's canvas
// -- the same drag-persistence call cards go through via SetPosition.
func (a *AtlasService) SetNotePosition(id string, pos atlas.Position) (atlas.Note, error) {
	a.mu.Lock()
	idx := a.findNoteLocked(id)
	if idx == -1 {
		a.mu.Unlock()
		return atlas.Note{}, fmt.Errorf("no note with id %q", id)
	}
	previous := a.notes[idx]
	n := previous
	n.Position = pos
	n.UpdatedAt = time.Now()
	a.notes[idx] = n
	perr := a.persistLocked()
	if perr != nil {
		a.notes[idx] = previous
	}
	a.mu.Unlock()
	if perr != nil {
		return atlas.Note{}, fmt.Errorf("save note position: %w", perr)
	}
	dataevent.Emit("atlas", n.ID)
	return n, nil
}

// MoveNote reparents a note (drag filing into/out of an area frame,
// goal 0081 A2) -- same containment-existence check CreateNote runs.
// A note can never contain anything, so no cycle check is needed the
// way MoveCard's atlas.WouldCycle is.
func (a *AtlasService) MoveNote(id, newParentID string) (atlas.Note, error) {
	a.mu.Lock()
	idx := a.findNoteLocked(id)
	if idx == -1 {
		a.mu.Unlock()
		return atlas.Note{}, fmt.Errorf("no note with id %q", id)
	}
	n, err := reparentEntityLocked(a, a.notes, idx, newParentID, "note", func(x *atlas.Note, p string, t time.Time) {
		x.ParentID = p
		x.UpdatedAt = t
	})
	a.mu.Unlock()
	if err != nil {
		return atlas.Note{}, err
	}
	dataevent.Emit("atlas", n.ID)
	return n, nil
}

// DeleteNote lives in atlasservice_tombstone.go (goal 0093's soft-
// delete guard) -- a note can never contain anything, so no promotion
// concern applies the way it does for DeleteCard.

// PromoteNote is the note's one-way lifecycle event (the LOCKED
// design's "promotion ritual"): it becomes a typed Card in place --
// same position, same parent, title and kind supplied by the caller
// (the placement-popover form in promote mode), the note's own text
// carried onto the new card's Note field. Atomic under a.mu: the kind
// is resolved and the card validated BEFORE the note is touched, so a
// bad kindID (or any other validation failure) leaves the note
// completely untouched -- no half-promoted state ever exists.
func (a *AtlasService) PromoteNote(noteID, kindID, title string) (atlas.Card, error) {
	a.mu.Lock()
	noteIdx := a.findNoteLocked(noteID)
	if noteIdx == -1 {
		a.mu.Unlock()
		return atlas.Card{}, fmt.Errorf("no note with id %q", noteID)
	}
	note := a.notes[noteIdx]
	kind, err := a.resolveKindLocked(kindID)
	if err != nil {
		a.mu.Unlock()
		return atlas.Card{}, err
	}
	now := time.Now()
	pos := note.Position
	c := atlas.Card{
		ID: seeding.NewSlugID(title, "card"), KindID: kindID, Title: title, Note: note.Text,
		ParentID: note.ParentID, Position: &pos, CreatedAt: now, UpdatedAt: now,
	}
	if err := atlas.ValidateCard(c, kind); err != nil {
		a.mu.Unlock()
		return atlas.Card{}, err
	}
	a.notes = append(a.notes[:noteIdx], a.notes[noteIdx+1:]...)
	a.cards = append(a.cards, c)
	// Authoring-while-active (ADR-0041): the promoted card joins the
	// active perspective, same as any other freshly created card.
	// Snapshot first -- a persist failure below must roll this back too.
	previousPerspectives := append([]atlas.Perspective(nil), a.perspectives...)
	a.joinActivePerspectiveWithCardLocked(c.ID)
	perr := a.persistLocked()
	if perr != nil {
		a.notes = insertNoteAt(a.notes, noteIdx, note)
		a.cards = a.cards[:len(a.cards)-1]
		a.perspectives = previousPerspectives
	}
	a.mu.Unlock()
	if perr != nil {
		return atlas.Card{}, fmt.Errorf("save promoted card: %w", perr)
	}
	dataevent.Emit("atlas", c.ID)
	a.notifyCardChange(c, "create", "")
	return c, nil
}

func insertNoteAt(notes []atlas.Note, idx int, n atlas.Note) []atlas.Note {
	if idx < 0 || idx > len(notes) {
		idx = len(notes)
	}
	notes = append(notes, atlas.Note{})
	copy(notes[idx+1:], notes[idx:])
	notes[idx] = n
	return notes
}
