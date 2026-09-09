package atlassvc

import (
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/seeding"
)

// demotedDiagramExtensions restates useAtlasNativeFileDrop.ts's own
// DIAGRAM_EXTENSIONS for the reverse direction: DemoteCard must
// reconstruct the SAME BoardObject Kind a fresh drop of the card's own
// MirrorPath would have landed as, so a promote/demote round trip
// returns exactly the object it started from. ".drawio.svg" is
// deliberately absent -- both a fresh drop and this Kind lookup route
// it through the plain image door (mirror.go's own ClassifyMirrorKind
// comment on ".drawio.svg").
var demotedDiagramExtensions = map[string]bool{
	".drawio": true, ".mmd": true, ".mermaid": true,
}

// demotedObjectKind reports the BoardObject Kind DemoteCard should
// recreate for card, and whether card carries a demotable backing at
// all. A List projection becomes "table" -- the one Kind
// ProjectionListID rides (boardobjectkind.go); a diagram-extension
// mirror becomes "diagram"; any other recognized image extension
// becomes "image". A card with neither a projection nor a
// diagram/image mirror (a plain note-card, or one backed by markdown/
// PDF/another file type) has nothing to demote to.
func demotedObjectKind(card atlas.Card) (string, bool) {
	if card.ProjectionListID != "" {
		return "table", true
	}
	if card.MirrorPath == "" {
		return "", false
	}
	ext := strings.ToLower(filepath.Ext(card.MirrorPath))
	if demotedDiagramExtensions[ext] {
		return "diagram", true
	}
	if atlas.IsImageExtension(ext) {
		return "image", true
	}
	return "", false
}

// demotedObjectPayload builds the new object's own Payload -- the SAME
// single key PromoteBoardObject reads off the object it consumes
// (mirrorPath for a file-backed kind, listID for "table"), so a
// subsequent re-promotion reads it back unchanged.
func demotedObjectPayload(kind string, card atlas.Card) map[string]string {
	if kind == "table" {
		return map[string]string{"listID": card.ProjectionListID}
	}
	return map[string]string{"mirrorPath": card.MirrorPath}
}

// DemoteCard is "Turn back into object" (goal 0410 Decision 3): the
// user-initiated inverse of PromoteBoardObject/PromoteNote for a card
// whose Kind is backed by a mirror file (image, drawio/mermaid
// diagram) or a projected List (table) -- it creates a BoardObject
// carrying the SAME mirror path/listID, position and size the card
// held, in the card's own parent, then removes the card and every link
// touching it (the confirm this rides behind names both losses); the
// diagram/image/table content itself survives because the object
// keeps the same mirrorPath/listID. ONE undo mark restores the EXACT
// demoted card AND its links (demoteCardAndLinks/repromoteObjectAndLinks
// below are a pure struct-swap the same way
// demoteCardToObject/repromoteObjectToCard are for a fresh promotion's
// own undo (atlasundo_promote.go) -- no new id is ever minted on either
// side, so undo/redo can alternate any number of times without drift).
func (a *AtlasService) DemoteCard(cardID string) (atlas.BoardObject, error) {
	a.mu.RLock()
	idx := a.findCardLocked(cardID)
	if idx == -1 {
		a.mu.RUnlock()
		return atlas.BoardObject{}, fmt.Errorf("no card with id %q", cardID)
	}
	if !a.cards[idx].DeletedAt.IsZero() {
		a.mu.RUnlock()
		return atlas.BoardObject{}, fmt.Errorf("card %q is already deleted", cardID)
	}
	card := a.cards[idx]
	var touchingLinks []atlas.Link
	for _, l := range a.links {
		if l.FromCardID == cardID || l.ToCardID == cardID {
			touchingLinks = append(touchingLinks, l)
		}
	}
	a.mu.RUnlock()

	kind, ok := demotedObjectKind(card)
	if !ok {
		return atlas.BoardObject{}, fmt.Errorf("card %q has no mirror or list backing to turn back into an object", cardID)
	}

	pos := atlas.Position{}
	if card.Position != nil {
		pos = *card.Position
	}
	var size *atlas.Dimensions
	if card.Size != nil {
		sz := *card.Size
		size = &sz
	}
	now := time.Now()
	obj := atlas.BoardObject{
		ID: seeding.NewSlugID(kind, "object"), Kind: kind, Payload: demotedObjectPayload(kind, card),
		Position: pos, Size: size, ParentID: card.ParentID, CreatedAt: now, UpdatedAt: now,
	}
	if err := atlas.ValidateBoardObject(obj); err != nil {
		return atlas.BoardObject{}, err
	}

	if err := a.demoteCardAndLinks(cardID, obj, touchingLinks); err != nil {
		return atlas.BoardObject{}, err
	}

	capturedCard, capturedObj, capturedLinks := card, obj, touchingLinks
	a.recordUndo(actorUI, "card", cardID, card.Title,
		func(a *AtlasService) error { return a.repromoteObjectAndLinks(capturedObj.ID, capturedCard, capturedLinks) },
		func(a *AtlasService) error { return a.demoteCardAndLinks(capturedCard.ID, capturedObj, capturedLinks) },
	)
	return obj, nil
}

// demoteCardAndLinks is DemoteCard's own atomic swap (and its redo):
// cardID is replaced by obj, and every link in links (cardID's own
// touching set, captured by the caller before this ran) is removed --
// a single persist, so a demote either fully lands or the card and its
// links are untouched. Also swaps the live mirror watch from cardID to
// obj.ID (a no-op for a non-diagram mirrorPath) -- called on both the
// initial demote and every redo, so the swap never drifts from the
// card/object pair actually on the board.
func (a *AtlasService) demoteCardAndLinks(cardID string, obj atlas.BoardObject, links []atlas.Link) error {
	a.mu.Lock()
	idx := a.findCardLocked(cardID)
	if idx == -1 {
		a.mu.Unlock()
		return fmt.Errorf("no card with id %q", cardID)
	}
	previousCards := append([]atlas.Card(nil), a.cards...)
	previousObjects := append([]atlas.BoardObject(nil), a.objects...)
	previousLinks := append([]atlas.Link(nil), a.links...)
	removeSet := make(map[string]bool, len(links))
	for _, l := range links {
		removeSet[l.ID] = true
	}
	kept := make([]atlas.Link, 0, len(a.links))
	for _, l := range a.links {
		if !removeSet[l.ID] {
			kept = append(kept, l)
		}
	}
	a.cards = append(a.cards[:idx], a.cards[idx+1:]...)
	a.objects = append(a.objects, obj)
	a.links = kept
	perr := a.persistLocked()
	if perr != nil {
		a.cards = previousCards
		a.objects = previousObjects
		a.links = previousLinks
	}
	a.mu.Unlock()
	if perr != nil {
		return fmt.Errorf("save demote: %w", perr)
	}
	dataevent.Emit("atlas", cardID)
	dataevent.Emit("atlas", obj.ID)
	a.disarmMirrorWatch(cardID)
	a.armMirrorWatch(obj.ID, obj.Payload["mirrorPath"])
	return nil
}

// repromoteObjectAndLinks is demoteCardAndLinks's own inverse (DemoteCard's
// undo): objectID is replaced by card (restored exactly, same id) and
// links rejoins a.links, removing the demoted object. Swaps the live
// mirror watch back from objectID to card.ID -- demoteCardAndLinks's
// own inverse, so alternating undo/redo never leaves a stale watch on
// a since-removed id.
func (a *AtlasService) repromoteObjectAndLinks(objectID string, card atlas.Card, links []atlas.Link) error {
	a.mu.Lock()
	idx := a.findObjectLocked(objectID)
	if idx == -1 {
		a.mu.Unlock()
		return fmt.Errorf("no board object with id %q", objectID)
	}
	previousCards := append([]atlas.Card(nil), a.cards...)
	previousObjects := append([]atlas.BoardObject(nil), a.objects...)
	previousLinks := append([]atlas.Link(nil), a.links...)
	a.objects = append(a.objects[:idx], a.objects[idx+1:]...)
	a.cards = append(a.cards, card)
	a.links = append(append([]atlas.Link(nil), a.links...), links...)
	perr := a.persistLocked()
	if perr != nil {
		a.cards = previousCards
		a.objects = previousObjects
		a.links = previousLinks
	}
	a.mu.Unlock()
	if perr != nil {
		return fmt.Errorf("save repromote: %w", perr)
	}
	dataevent.Emit("atlas", card.ID)
	dataevent.Emit("atlas", objectID)
	a.disarmMirrorWatch(objectID)
	a.armMirrorWatch(card.ID, card.MirrorPath)
	return nil
}
