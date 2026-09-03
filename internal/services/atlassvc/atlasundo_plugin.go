package atlassvc

import (
	"fmt"
	"time"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/seeding"
)

// The plugin content-plane doors (docs/goals/0289): the SAME create/
// update cores the UI and MCP use, recorded under their own undo actor
// so a plugin's write is journaled honestly (never popped by the UI's
// own Undo, like MCP's). Every caller is pluginsvc's guarded door --
// nothing here is Wails-bound or reachable from plugin code directly.

const actorPlugin undoActor = "plugin"

// CreateCardForPlugin mirrors CreateCardForMCP with actor=plugin.
//
//wails:ignore
func (a *AtlasService) CreateCardForPlugin(kindID, title, note string, fields map[string]string, parentID string) (atlas.Card, error) {
	return a.createCardWithID(seeding.NewSlugID(title, "card"), kindID, title, note, fields, parentID, nil, "", "", "", "", "", "", actorPlugin)
}

// UpdateCardForPlugin mirrors UpdateCardForMCP with actor=plugin;
// source/mirror/refresh stay untouched (a plugin edits content, never
// a card's provenance).
//
//wails:ignore
func (a *AtlasService) UpdateCardForPlugin(id, title, note string, fields map[string]string) (atlas.Card, error) {
	c, previous, err := a.updateCardCore(id, title, note, fields, "", "", "")
	if err != nil {
		return c, err
	}
	recordCardContentUndo(a, actorPlugin, id, title, previous, c)
	return c, nil
}

// CreateNoteForPlugin is CreateNote with actor=plugin and a chosen
// position: a nil pos lands the note just right of the parent's
// right-most item (or of the board's, at the root) so plugin-made
// notes never stack on one spot.
//
//wails:ignore
func (a *AtlasService) CreateNoteForPlugin(text, parentID string, pos *atlas.Position) (atlas.Note, error) {
	a.mu.Lock()
	if parentID != "" && a.findCardLocked(parentID) == -1 {
		a.mu.Unlock()
		return atlas.Note{}, fmt.Errorf("no card with id %q to contain this note", parentID)
	}
	position := a.nextFreePositionLocked(parentID)
	if pos != nil {
		position = *pos
	}
	now := time.Now()
	n := atlas.Note{ID: seeding.NewSlugID(text, "note"), Text: text, Position: position, ParentID: parentID, CreatedAt: now, UpdatedAt: now}
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
	created := n.ID
	a.recordUndo(actorPlugin, "note", created, text,
		func(a *AtlasService) error { _, err := a.DeleteNote(created); return err },
		func(a *AtlasService) error { return a.UndoDelete(nil, []string{created}, nil) },
	)
	return n, nil
}

// nextFreePositionLocked: one slot to the right of the right-most
// live sibling under parentID (cards, notes, objects), on its row --
// deterministic, never overlapping an existing item's origin. Zero
// when the parent is empty.
func (a *AtlasService) nextFreePositionLocked(parentID string) atlas.Position {
	const gap = 40
	edges := a.siblingRightEdgesLocked(parentID)
	if len(edges) == 0 {
		return atlas.Position{}
	}
	best := edges[0]
	for _, e := range edges[1:] {
		if e.X > best.X {
			best = e
		}
	}
	return atlas.Position{X: best.X + gap, Y: best.Y}
}

// siblingRightEdgesLocked lists each live sibling's right edge (its
// origin plus its width, a default when unsized) with its row.
func (a *AtlasService) siblingRightEdgesLocked(parentID string) []atlas.Position {
	widthOr := func(size *atlas.Dimensions, fallback float64) float64 {
		if size != nil {
			return size.W
		}
		return fallback
	}
	var edges []atlas.Position
	for _, c := range a.cards {
		if c.ParentID == parentID && c.DeletedAt.IsZero() && c.Position != nil {
			edges = append(edges, atlas.Position{X: c.Position.X + widthOr(c.Size, 240), Y: c.Position.Y})
		}
	}
	for _, n := range a.notes {
		if n.ParentID == parentID && n.DeletedAt.IsZero() {
			edges = append(edges, atlas.Position{X: n.Position.X + widthOr(n.Size, 200), Y: n.Position.Y})
		}
	}
	for _, o := range a.objects {
		if o.ParentID == parentID && o.DeletedAt.IsZero() {
			edges = append(edges, atlas.Position{X: o.Position.X + widthOr(o.Size, 240), Y: o.Position.Y})
		}
	}
	return edges
}
