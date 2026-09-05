package atlassvc

import (
	"fmt"
	"strconv"
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
	a.armMirrorWatch(o.ID, o.Payload["mirrorPath"])
	created := o.ID
	a.recordUndo(actorUI, "object", created, kind,
		func(a *AtlasService) error { _, err := a.DeleteBoardObject(created); return err },
		func(a *AtlasService) error { return a.UndoDelete(nil, nil, []string{created}) },
	)
	return o, nil
}

// SetBoardObjectPosition updates a board object's placement within its
// parent's canvas -- the same drag-persistence call cards/notes go
// through via SetPosition/SetNotePosition.
//
//nolint:dupl // same lock/mutate/persist/emit/recordScalar shape as SetNotePosition -- a shared generic setter is a larger refactor than this slice's scope
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
	recordScalar(a, actorUI, "object", id, o.Kind,
		func(a *AtlasService, p atlas.Position) error { _, err := a.SetBoardObjectPosition(id, p); return err },
		previous.Position, pos,
	)
	return o, nil
}

// SetBoardObjectPayload merges patch into a board object's Payload --
// the content-plane write door for a payload-carrying object whose
// data changes after placement (docs/goals/0249: a plugin object's own
// fields, written host-mediated so plugin code never touches a
// binding). A key with an empty value deletes that key; every other
// key overwrites. mirrorPath changes re-arm the file watch the same
// way creation does.
//
//nolint:dupl // same lock/mutate/persist/emit/recordScalar shape as SetBoardObjectPosition -- see its own dupl note
func (a *AtlasService) SetBoardObjectPayload(id string, patch map[string]string) (atlas.BoardObject, error) {
	a.mu.Lock()
	idx := a.findObjectLocked(id)
	if idx == -1 {
		a.mu.Unlock()
		return atlas.BoardObject{}, fmt.Errorf("no board object with id %q", id)
	}
	previous := a.objects[idx]
	o := previous
	o.Payload = copyPayload(previous.Payload)
	for k, v := range patch {
		if v == "" {
			delete(o.Payload, k)
			continue
		}
		o.Payload[k] = v
	}
	o.UpdatedAt = time.Now()
	a.objects[idx] = o
	perr := a.persistLocked()
	if perr != nil {
		a.objects[idx] = previous
	}
	a.mu.Unlock()
	if perr != nil {
		return atlas.BoardObject{}, fmt.Errorf("save board object payload: %w", perr)
	}
	dataevent.Emit("atlas", o.ID)
	a.armMirrorWatch(o.ID, o.Payload["mirrorPath"])
	recordScalar(a, actorUI, "object", id, o.Kind,
		func(a *AtlasService, prev map[string]string) error {
			a.mu.Lock()
			if i := a.findObjectLocked(id); i != -1 {
				restored := a.objects[i]
				restored.Payload = copyPayload(prev)
				restored.UpdatedAt = time.Now()
				a.objects[i] = restored
				if err := a.persistLocked(); err != nil {
					a.mu.Unlock()
					return err
				}
				a.mu.Unlock()
				dataevent.Emit("atlas", id)
				return nil
			}
			a.mu.Unlock()
			return fmt.Errorf("no board object with id %q", id)
		},
		previous.Payload, o.Payload,
	)
	return o, nil
}

// SetBoardObjectSize persists a user-driven resize -- nil until the
// object's own natural/intrinsic render size is first overridden (S2+;
// S1 never calls this, but the door exists so a future resize handle
// costs a frontend call, not a schema change). The floor matches the
// frontend resize handle's own minWidth/minHeight (AtlasBoardObjectNode's
// NodeResizer, goal 0199 part B) -- a resize below it is refused here
// too, never persisted as a degenerate box.
//
//nolint:dupl // same lock/mutate/persist/emit/recordSizeChange shape as SetNoteSize -- a shared generic setter is a larger refactor than this slice's scope
func (a *AtlasService) SetBoardObjectSize(id string, size atlas.Dimensions) (atlas.BoardObject, error) {
	if size.W < 40 || size.H < 40 {
		return atlas.BoardObject{}, fmt.Errorf("board object size %.0fx%.0f is too small", size.W, size.H)
	}
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
	recordSizeChange(a, "object", id, o.Kind, previous.Size, &size,
		func(a *AtlasService, sz atlas.Dimensions) error { _, err := a.SetBoardObjectSize(id, sz); return err },
		func(a *AtlasService) error { _, err := a.clearBoardObjectSize(id); return err },
	)
	return o, nil
}

// clearBoardObjectSize resets a board object's Size to nil (its
// natural/intrinsic render size) -- the undo-only door a first-ever
// resize's undo entry replays through, since SetBoardObjectSize's own
// minimum-size guard would otherwise refuse the return to "unsized"
// the same way it refuses an illegal undersized resize. Never called
// directly by a mutation door's public surface, only from
// recordSizeChange's own apply closure above, so it carries no
// recordUndo call of its own (ADR-0044's suppressRecording already
// covers the replay).
func (a *AtlasService) clearBoardObjectSize(id string) (atlas.BoardObject, error) {
	a.mu.Lock()
	idx := a.findObjectLocked(id)
	if idx == -1 {
		a.mu.Unlock()
		return atlas.BoardObject{}, fmt.Errorf("no board object with id %q", id)
	}
	previous := a.objects[idx]
	o := previous
	o.Size = nil
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

// SetBoardObjectRotation persists a shape's rotation angle in degrees
// (goal 0214) -- same scoped-setter shape as SetBoardObjectPosition/
// SetBoardObjectSize, writing into Payload rather than a dedicated
// struct field since rotation lives at the same tier as a shape's
// other style keys (fill/stroke/strokeWidth, shapeTool.ts's own "style
// lives in Payload" contract). Payload is copied before mutation so a
// failed persist can roll back to `previous` without also reverting
// the caller's own map (maps are reference types; mutating the shared
// map in place would corrupt the rollback). Kind-agnostic like every
// other setter here -- the frontend decides which Kinds ever call it.
func (a *AtlasService) SetBoardObjectRotation(id string, degrees float64) (atlas.BoardObject, error) {
	a.mu.Lock()
	idx := a.findObjectLocked(id)
	if idx == -1 {
		a.mu.Unlock()
		return atlas.BoardObject{}, fmt.Errorf("no board object with id %q", id)
	}
	previous := a.objects[idx]
	o := previous
	o.Payload = copyPayload(previous.Payload)
	if o.Payload == nil {
		o.Payload = map[string]string{}
	}
	o.Payload["rotation"] = strconv.FormatFloat(degrees, 'f', -1, 64)
	o.UpdatedAt = time.Now()
	a.objects[idx] = o
	perr := a.persistLocked()
	if perr != nil {
		a.objects[idx] = previous
	}
	a.mu.Unlock()
	if perr != nil {
		return atlas.BoardObject{}, fmt.Errorf("save board object rotation: %w", perr)
	}
	dataevent.Emit("atlas", o.ID)
	prevDegrees, _ := strconv.ParseFloat(previous.Payload["rotation"], 64)
	recordScalar(a, actorUI, "object", id, o.Kind,
		func(a *AtlasService, d float64) error { _, err := a.SetBoardObjectRotation(id, d); return err },
		prevDegrees, degrees,
	)
	return o, nil
}

// MoveBoardObject reparents a board object (drag filing into/out of an
// area frame) -- same containment-existence check CreateBoardObject
// runs. A board object can never contain anything, so no cycle check
// is needed the way MoveCard's atlas.WouldCycle is.
//
//nolint:dupl // same lock/reparent/emit/recordScalar shape as MoveNote -- a shared generic mover is a larger refactor than this slice's scope
func (a *AtlasService) MoveBoardObject(id, newParentID string) (atlas.BoardObject, error) {
	a.mu.Lock()
	idx := a.findObjectLocked(id)
	if idx == -1 {
		a.mu.Unlock()
		return atlas.BoardObject{}, fmt.Errorf("no board object with id %q", id)
	}
	previous := a.objects[idx]
	o, err := reparentEntityLocked(a, a.objects, idx, newParentID, "board object", func(x *atlas.BoardObject, p string, t time.Time) {
		x.ParentID = p
		x.UpdatedAt = t
	})
	a.mu.Unlock()
	if err != nil {
		return atlas.BoardObject{}, err
	}
	dataevent.Emit("atlas", o.ID)
	recordScalar(a, actorUI, "object", id, o.Kind,
		func(a *AtlasService, p string) error { _, err := a.MoveBoardObject(id, p); return err },
		previous.ParentID, newParentID,
	)
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
	a.disarmMirrorWatch(objectID)
	a.armMirrorWatch(c.ID, c.MirrorPath)
	a.notifyCardChange(c, "create", "")
	capturedObj, capturedCard := obj, c
	a.recordUndo(actorUI, "object", objectID, title,
		func(a *AtlasService) error { return a.demoteCardToObject(capturedCard.ID, capturedObj) },
		func(a *AtlasService) error { return a.repromoteObjectToCard(capturedObj.ID, capturedCard) },
	)
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
