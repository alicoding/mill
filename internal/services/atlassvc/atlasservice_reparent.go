package atlassvc

import (
	"time"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/services/dataevent"
)

// These mirror frontend/src/atlas/atlasBoardLayout.ts's own NOTE_WIDTH/
// NOTE_HEIGHT/BOARD_GAP and AtlasShapeContent.tsx's default shape
// footprint -- read here only to estimate how far a re-parented board
// object must land to clear whatever else already occupies its new
// parent (goal 0233), never to reproduce the frontend's own
// row-wrapping pixel-for-pixel. reparentFrameHeight is deliberately
// generous rather than replicating computeGroupFrameLayout's real
// (child-count-dependent) height: a frame card's rendered footprint
// varies with its own children, which this package has no layout
// engine to compute.
const (
	reparentLeafHeight  = 128
	reparentFrameHeight = 400
	reparentGap         = 24
	// reparentObjectFootprintW/H mirror atlasBoardLayout.ts's own
	// OBJECT_FALLBACK_EXTENT: AtlasBoardObjectNode.module.css clamps
	// an unsized object's content to 480px per axis, so that box --
	// not a smaller guess -- is how far the NEXT re-parented object must
	// land to clear it. TestReparentObjectFootprint_MatchesFrontendFallbackExtent
	// fails the build if either language's number moves alone.
	reparentObjectFootprintW = 480
	reparentObjectFootprintH = 480
	// reparentTableFootprintW/H mirror atlasBoardLayout.ts's own
	// TABLE_WIDTH/TABLE_HEIGHT -- the unsized default every
	// table-shaped face (sheet, json's tree) renders at, wider still
	// than the 480px clamp every other unsized Kind fits inside.
	reparentTableFootprintW = 520
	reparentTableFootprintH = 320
)

// reparentObjectFootprint returns the (W, H) estimate for a Kind that
// carries no persisted Size -- most Kinds fit inside the generic
// reparentObjectFootprintW/H clamp, but a table-shaped Kind defaults
// to a visibly wider unsized render than that (its own content face's
// own frameStyle), so the generic fallback under-estimates it enough
// to leave the NEXT re-parented object landing on top of it.
func reparentObjectFootprint(kind string) (float64, float64) {
	switch kind {
	case "sheet", "json", "table":
		return reparentTableFootprintW, reparentTableFootprintH
	default:
		return reparentObjectFootprintW, reparentObjectFootprintH
	}
}

// reparentState is prepareReparentLocked's own report to DeleteCard:
// which board objects it moved and where each one was before, so the
// caller can roll the write back on a persist failure or restore it
// from an undo entry. A zero value (nil objectIDs) means "this delete
// had no board-object children to re-parent."
type reparentState struct {
	objectIDs []string
	original  map[string]atlas.Position
}

// directLiveObjectIDsLocked returns the ids of every live board object
// whose stored ParentID is exactly cardID -- the identity behind the
// count directLiveChildCountLocked already reports, needed here so the
// caller can reposition each one individually. Caller must hold a.mu.
func (a *AtlasService) directLiveObjectIDsLocked(cardID string) []string {
	var ids []string
	for _, o := range a.objects {
		if o.ParentID == cardID && o.DeletedAt.IsZero() {
			ids = append(ids, o.ID)
		}
	}
	return ids
}

// cardHasLiveChildLocked reports whether any other live card treats
// cardID as its parent -- the same structural test
// atlasBoardLayout.ts's own isGroupCard uses, checked here only to
// pick a taller clearance estimate for a frame than a leaf note-card
// needs. Caller must hold a.mu.
func (a *AtlasService) cardHasLiveChildLocked(cardID string) bool {
	for _, c := range a.cards {
		if c.ParentID == cardID && c.DeletedAt.IsZero() {
			return true
		}
	}
	return false
}

// prepareReparentLocked is DeleteCard's own seam for goal 0233's
// write-once fix: a re-parented board object previously kept its raw X/Y
// from the board it was re-parented OFF of, landing on top of unrelated
// content at the destination (the mechanism named in that goal's own
// file). Called AFTER id's own DeletedAt is stamped (so
// EffectiveParentID resolves the POST-delete context), it repositions
// every direct board-object child clear of everything already live at
// the new effective parent, and returns enough state for the caller's
// own rollback/undo composition. Caller must hold a.mu.
func (a *AtlasService) prepareReparentLocked(id string) reparentState {
	ids := a.directLiveObjectIDsLocked(id)
	if len(ids) == 0 {
		return reparentState{}
	}
	newParentID := atlas.EffectiveParentID(a.cardsByIDLocked(), id)
	return reparentState{objectIDs: ids, original: a.repositionReparentedObjectsLocked(ids, newParentID)}
}

// occupiedMaxYLocked is repositionReparentedObjectsLocked's own scan:
// the lowest Y any live card, note, or object already occupying
// newParentID reaches, so a re-parented object can be placed clear of all
// of it. Every stored ParentID is resolved through EffectiveParentID
// before comparing against newParentID -- an existing card/note/object
// can ITSELF already be a virtually-re-parented child of a tombstoned
// ancestor (liveCardsLocked's own read-time contract), so a raw
// equality check here would miss exactly the sibling this goal exists
// to clear (a card re-parented past its own tombstoned parent still
// carries that parent's raw id in a.cards). Caller must hold a.mu.
func (a *AtlasService) occupiedMaxYLocked(byID map[string]atlas.Card, newParentID string) float64 {
	maxY := a.occupiedMaxYFromCardsLocked(byID, newParentID)
	maxY = max(maxY, a.occupiedMaxYFromNotesLocked(byID, newParentID))
	return max(maxY, a.occupiedMaxYFromObjectsLocked(byID, newParentID))
}

// occupiedMaxYFromCardsLocked is occupiedMaxYLocked's own card pass --
// split out purely to stay under gocognit's per-function ceiling
// (testing.md's quality gate), never called except from there. Caller
// must hold a.mu.
func (a *AtlasService) occupiedMaxYFromCardsLocked(byID map[string]atlas.Card, newParentID string) float64 {
	maxY := 0.0
	for _, c := range a.cards {
		if atlas.EffectiveParentID(byID, c.ParentID) != newParentID || !c.DeletedAt.IsZero() || c.Position == nil {
			continue
		}
		h := float64(reparentLeafHeight)
		if a.cardHasLiveChildLocked(c.ID) {
			h = reparentFrameHeight
		}
		maxY = max(maxY, c.Position.Y+h)
	}
	return maxY
}

// occupiedMaxYFromNotesLocked is occupiedMaxYLocked's own note pass --
// same split-for-gocognit reason as its card sibling above. Caller
// must hold a.mu.
func (a *AtlasService) occupiedMaxYFromNotesLocked(byID map[string]atlas.Card, newParentID string) float64 {
	maxY := 0.0
	for _, n := range a.notes {
		if atlas.EffectiveParentID(byID, n.ParentID) != newParentID || !n.DeletedAt.IsZero() {
			continue
		}
		maxY = max(maxY, n.Position.Y+reparentLeafHeight)
	}
	return maxY
}

// occupiedMaxYFromObjectsLocked is occupiedMaxYLocked's own object
// pass -- same split-for-gocognit reason as its card sibling above.
// Caller must hold a.mu.
func (a *AtlasService) occupiedMaxYFromObjectsLocked(byID map[string]atlas.Card, newParentID string) float64 {
	maxY := 0.0
	for _, o := range a.objects {
		if atlas.EffectiveParentID(byID, o.ParentID) != newParentID || !o.DeletedAt.IsZero() {
			continue
		}
		_, h := reparentObjectFootprint(o.Kind)
		if o.Size != nil {
			h = o.Size.H
		}
		maxY = max(maxY, o.Position.Y+h)
	}
	return maxY
}

// repositionReparentedObjectsLocked assigns each of objectIDs a fresh
// position below every live card, note, and object already occupying
// newParentID (occupiedMaxYLocked above), laid out in a single row so
// multiple simultaneously-re-parented objects don't stack on each other
// either. Returns the position each object held BEFORE this call.
// Caller must hold a.mu.
func (a *AtlasService) repositionReparentedObjectsLocked(objectIDs []string, newParentID string) map[string]atlas.Position {
	previous := make(map[string]atlas.Position, len(objectIDs))
	maxY := a.occupiedMaxYLocked(a.cardsByIDLocked(), newParentID)
	y := 0.0
	if maxY > 0 {
		y = maxY + reparentGap
	}
	now := time.Now()
	x := 0.0
	for _, id := range objectIDs {
		idx := a.findObjectLocked(id)
		if idx == -1 {
			continue
		}
		previous[id] = a.objects[idx].Position
		w, _ := reparentObjectFootprint(a.objects[idx].Kind)
		if a.objects[idx].Size != nil {
			w = a.objects[idx].Size.W
		}
		a.objects[idx].Position = atlas.Position{X: x, Y: y}
		a.objects[idx].UpdatedAt = now
		x += w + reparentGap
	}
	return previous
}

// rollbackReparentLocked restores exactly the positions
// prepareReparentLocked changed -- DeleteCard's own persist-failure
// path, the same shape as its sibling `a.cards[idx] = previous`
// restore. Caller must hold a.mu.
func (a *AtlasService) rollbackReparentLocked(s reparentState) {
	for oid, pos := range s.original {
		if idx := a.findObjectLocked(oid); idx != -1 {
			a.objects[idx].Position = pos
		}
	}
}

// undoCardDeleteWithReparent is DeleteCard's own undoApply: restores
// id (UndoDelete's existing door) then restores exactly the positions
// prepareReparentLocked moved, so undoing a delete that re-parented
// board-object children puts them back where they were, not where
// they landed after the re-parent.
func (a *AtlasService) undoCardDeleteWithReparent(id string, reparent reparentState) error {
	if err := a.UndoDelete([]string{id}, nil, nil); err != nil {
		return err
	}
	return a.restoreReparentedObjectPositions(reparent.original)
}

// restoreReparentedObjectPositions writes back exactly the positions a
// prior prepareReparentLocked call returned -- undo's own door for
// the position half of a card delete that re-parented board-object
// children (goal 0233), called sequentially after UndoDelete through
// the same "apply the inverse as a new operation" convention every
// undo entry uses (atlasundo.go's own header comment), never nested
// inside another door's lock.
func (a *AtlasService) restoreReparentedObjectPositions(positions map[string]atlas.Position) error {
	if len(positions) == 0 {
		return nil
	}
	a.mu.Lock()
	now := time.Now()
	for id, pos := range positions {
		if idx := a.findObjectLocked(id); idx != -1 {
			a.objects[idx].Position = pos
			a.objects[idx].UpdatedAt = now
		}
	}
	perr := a.persistLocked()
	a.mu.Unlock()
	if perr != nil {
		return perr
	}
	for id := range positions {
		dataevent.Emit("atlas", id)
	}
	return nil
}
