package atlassvc

import (
	"fmt"
	"time"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/seeding"
)

// --- Board objects (goal 0179/0180) ---
//
// A BoardObject is a canvas-native peer to Card: position, render,
// select, move, erase, undo -- never a document (no title, no Kind, no
// links, no filing semantics beyond spatial placement). One generic
// entity discriminated by Kind, matching Note's own structural
// exclusion (atlasnote.go's header comment) rather than a hand-built
// type per noun -- see internal/domain/atlas/boardobject.go's own
// header for why. PromoteBoardObject below is the one path from a
// BoardObject to a Card.

// CreateBoardObject makes a new BoardObject of kind, optionally inside
// parentID ("" for root-level) -- same containment-existence check
// CreateNote runs. payload is copied so the caller's own map can't
// mutate stored state after the call returns.
func (a *AtlasService) CreateBoardObject(kind string, payload map[string]string, pos atlas.Position, parentID string) (atlas.BoardObject, error) {
	a.mu.Lock()
	if parentID != "" && a.findCardLocked(parentID) == -1 {
		a.mu.Unlock()
		return atlas.BoardObject{}, fmt.Errorf("no card with id %q to contain this board object", parentID)
	}
	now := time.Now()
	o := atlas.BoardObject{
		ID: seeding.NewSlugID(kind, "object"), Kind: kind, Payload: copyPayload(payload),
		Position: pos, ParentID: parentID, CreatedAt: now, UpdatedAt: now,
	}
	if err := atlas.ValidateBoardObject(o); err != nil {
		a.mu.Unlock()
		return atlas.BoardObject{}, err
	}
	a.objects = append(a.objects, o)
	perr := a.persistLocked()
	if perr != nil {
		a.objects = a.objects[:len(a.objects)-1]
	}
	a.mu.Unlock()
	if perr != nil {
		return atlas.BoardObject{}, fmt.Errorf("save board object: %w", perr)
	}
	dataevent.Emit("atlas", o.ID)
	return o, nil
}

// SetBoardObjectPosition updates a board object's placement within its
// parent's canvas -- the same drag-persistence call cards/notes go
// through via SetPosition/SetNotePosition.
func (a *AtlasService) SetBoardObjectPosition(id string, pos atlas.Position) (atlas.BoardObject, error) {
	a.mu.Lock()
	idx := a.findObjectLocked(id)
	if idx == -1 {
		a.mu.Unlock()
		return atlas.BoardObject{}, fmt.Errorf("no board object with id %q", id)
	}
	previous := a.objects[idx]
	o := previous
	o.Position = pos
	o.UpdatedAt = time.Now()
	a.objects[idx] = o
	perr := a.persistLocked()
	if perr != nil {
		a.objects[idx] = previous
	}
	a.mu.Unlock()
	if perr != nil {
		return atlas.BoardObject{}, fmt.Errorf("save board object position: %w", perr)
	}
	dataevent.Emit("atlas", o.ID)
	return o, nil
}

// SetBoardObjectSize persists a user-driven resize -- nil until the
// object's own natural/intrinsic render size is first overridden (S2+;
// S1 never calls this, but the door exists so a future resize handle
// costs a frontend call, not a schema change).
func (a *AtlasService) SetBoardObjectSize(id string, size atlas.Dimensions) (atlas.BoardObject, error) {
	a.mu.Lock()
	idx := a.findObjectLocked(id)
	if idx == -1 {
		a.mu.Unlock()
		return atlas.BoardObject{}, fmt.Errorf("no board object with id %q", id)
	}
	previous := a.objects[idx]
	o := previous
	o.Size = &size
	o.UpdatedAt = time.Now()
	a.objects[idx] = o
	perr := a.persistLocked()
	if perr != nil {
		a.objects[idx] = previous
	}
	a.mu.Unlock()
	if perr != nil {
		return atlas.BoardObject{}, fmt.Errorf("save board object size: %w", perr)
	}
	dataevent.Emit("atlas", o.ID)
	return o, nil
}

// MoveBoardObject reparents a board object (drag filing into/out of an
// area frame) -- same containment-existence check CreateBoardObject
// runs. A board object can never contain anything, so no cycle check
// is needed the way MoveCard's atlas.WouldCycle is.
func (a *AtlasService) MoveBoardObject(id, newParentID string) (atlas.BoardObject, error) {
	a.mu.Lock()
	idx := a.findObjectLocked(id)
	if idx == -1 {
		a.mu.Unlock()
		return atlas.BoardObject{}, fmt.Errorf("no board object with id %q", id)
	}
	o, err := reparentEntityLocked(a, a.objects, idx, newParentID, "board object", func(x *atlas.BoardObject, p string, t time.Time) {
		x.ParentID = p
		x.UpdatedAt = t
	})
	a.mu.Unlock()
	if err != nil {
		return atlas.BoardObject{}, err
	}
	dataevent.Emit("atlas", o.ID)
	return o, nil
}

// PromoteBoardObject is the object's one-way lifecycle event (the same
// promotion ritual PromoteNote runs): it becomes a typed Card in
// place -- same position, same parent, title and kind supplied by the
// caller. Whichever Payload key the object's own Kind carries rides
// onto the matching Card field: mirrorPath -> MirrorPath (image, ink,
// shape's own file-backed siblings, and diagram) so the promoted card
// renders through the exact same mirror-unit path a native file drop
// already used; listID -> ProjectionListID (table) so it keeps
// projecting the same List. A Kind that carries neither (shape) simply
// promotes to a plain card -- both assignments below are no-ops for it.
// checksum is computed BEFORE the lock is taken (fileChecksum does its
// own I/O) and never blocks promotion on failure, same fail-open
// posture CreateCardFromFileDrop takes. Atomic under a.mu: the kind is
// resolved and the card validated BEFORE the object is touched, so a
// bad kindID leaves the object completely untouched -- no half-
// promoted state ever exists.
func (a *AtlasService) PromoteBoardObject(objectID, kindID, title string) (atlas.Card, error) {
	a.mu.RLock()
	objIdx := a.findObjectLocked(objectID)
	var mirrorPath string
	if objIdx != -1 {
		mirrorPath = a.objects[objIdx].Payload["mirrorPath"]
	}
	a.mu.RUnlock()
	checksum, checksumErr := fileChecksum(mirrorPath)
	if checksumErr != nil {
		checksum = ""
	}

	a.mu.Lock()
	objIdx = a.findObjectLocked(objectID)
	if objIdx == -1 {
		a.mu.Unlock()
		return atlas.Card{}, fmt.Errorf("no board object with id %q", objectID)
	}
	obj := a.objects[objIdx]
	kind, err := a.resolveKindLocked(kindID)
	if err != nil {
		a.mu.Unlock()
		return atlas.Card{}, err
	}
	now := time.Now()
	pos := obj.Position
	c := atlas.Card{
		ID: seeding.NewSlugID(title, "card"), KindID: kindID, Title: title,
		ParentID: obj.ParentID, Position: &pos, MirrorPath: obj.Payload["mirrorPath"], MirrorChecksum: checksum,
		// ProjectionListID rides along for a "table" object exactly the
		// way MirrorPath does for a file-backed one -- a promoted table
		// keeps projecting the SAME List, through CardListProjection
		// rather than a second reader (goal 0179 S2).
		ProjectionListID: obj.Payload["listID"],
		CreatedAt:        now, UpdatedAt: now,
	}
	if err := atlas.ValidateCard(c, kind); err != nil {
		a.mu.Unlock()
		return atlas.Card{}, err
	}
	a.objects = append(a.objects[:objIdx], a.objects[objIdx+1:]...)
	a.cards = append(a.cards, c)
	// Authoring-while-active (ADR-0041): the promoted card joins the
	// active perspective, same as any other freshly created card.
	previousPerspectives := append([]atlas.Perspective(nil), a.perspectives...)
	a.joinActivePerspectiveWithCardLocked(c.ID)
	perr := a.persistLocked()
	if perr != nil {
		a.objects = insertObjectAt(a.objects, objIdx, obj)
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

func insertObjectAt(objects []atlas.BoardObject, idx int, o atlas.BoardObject) []atlas.BoardObject {
	if idx < 0 || idx > len(objects) {
		idx = len(objects)
	}
	objects = append(objects, atlas.BoardObject{})
	copy(objects[idx+1:], objects[idx:])
	objects[idx] = o
	return objects
}

func copyPayload(payload map[string]string) map[string]string {
	if payload == nil {
		return nil
	}
	out := make(map[string]string, len(payload))
	for k, v := range payload {
		out[k] = v
	}
	return out
}
