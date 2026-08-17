package atlassvc

import (
	"fmt"
	"time"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/seeding"
)

// CreateCardLinkedFrom atomically creates a new card AND links it from
// fromCardID via linkKindID, in one locked critical section (same
// single-persist/single-rollback shape PromoteNote and
// CreateLinkedFileCard already establish) -- the slot-drag guided-
// create door (goal 0081 slice A4, LOCKED design decision D1=B):
// releasing a link-slot drag on empty canvas names a thing and its
// relation in one motion, with no partial state -- a card with no
// link, or a link to nothing -- ever left behind on failure.
// linkKindID is caller-supplied (the dragged row already named its own
// kind); parentID/position are the frontend's own resolved "where you
// are" values, same convention every other canvas-foremost creation
// door already follows.
func (a *AtlasService) CreateCardLinkedFrom(fromCardID, linkKindID, kindID, title, parentID string, position *atlas.Position) (atlas.Card, error) {
	a.mu.Lock()
	if a.findCardLocked(fromCardID) == -1 {
		a.mu.Unlock()
		return atlas.Card{}, fmt.Errorf("no card with id %q", fromCardID)
	}
	card, link, err := a.buildLinkedCardLocked(fromCardID, linkKindID, kindID, title, parentID, position)
	if err != nil {
		a.mu.Unlock()
		return atlas.Card{}, err
	}
	return a.commitLinkedCardLocked(card, link)
}

// AddLinkedCard is CreateCardLinkedFrom's own "generic kind" door: the
// card menu's "Add linked card…" item (goal 0081 slice A4), which
// links through the built-in relates-to kind rather than naming one --
// same graceful-fallback resolution CreateLinkedFileCard's own
// resolveRelatesToLinkKindLocked already establishes, and the same
// "parent = the linking card's own parent" rule the LOCKED design's
// card-foremost creation door (§2b) requires: a linked sibling lands
// beside the card that named it, never wherever the board happens to
// be scrolled.
func (a *AtlasService) AddLinkedCard(fromCardID, kindID, title string, position *atlas.Position) (atlas.Card, error) {
	a.mu.Lock()
	fromIdx := a.findCardLocked(fromCardID)
	if fromIdx == -1 {
		a.mu.Unlock()
		return atlas.Card{}, fmt.Errorf("no card with id %q", fromCardID)
	}
	parentID := a.cards[fromIdx].ParentID
	linkKindID := a.resolveRelatesToLinkKindLocked()
	if linkKindID == "" {
		a.mu.Unlock()
		return atlas.Card{}, fmt.Errorf("no link kind declared to link a new card with")
	}
	card, link, err := a.buildLinkedCardLocked(fromCardID, linkKindID, kindID, title, parentID, position)
	if err != nil {
		a.mu.Unlock()
		return atlas.Card{}, err
	}
	return a.commitLinkedCardLocked(card, link)
}

// buildLinkedCardLocked validates and constructs the new card + link
// pair both public methods above persist -- never mutates a.cards/
// a.links itself, so a validation failure never has anything to roll
// back. Caller must hold a.mu.
func (a *AtlasService) buildLinkedCardLocked(fromCardID, linkKindID, kindID, title, parentID string, position *atlas.Position) (atlas.Card, atlas.Link, error) {
	kind, err := a.resolveKindLocked(kindID)
	if err != nil {
		return atlas.Card{}, atlas.Link{}, err
	}
	if a.findLinkKindLocked(linkKindID) == -1 {
		return atlas.Card{}, atlas.Link{}, fmt.Errorf("no link kind with id %q", linkKindID)
	}
	if parentID != "" && a.findCardLocked(parentID) == -1 {
		return atlas.Card{}, atlas.Link{}, fmt.Errorf("no card with id %q to contain this one", parentID)
	}
	now := time.Now()
	card := atlas.Card{
		ID: seeding.NewSlugID(title, "card"), KindID: kindID, Title: title,
		ParentID: parentID, Position: position, CreatedAt: now, UpdatedAt: now,
	}
	if err := atlas.ValidateCard(card, kind); err != nil {
		return atlas.Card{}, atlas.Link{}, err
	}
	link := atlas.Link{
		ID: seeding.NewSlugID(title, "link"), FromCardID: fromCardID, ToCardID: card.ID,
		LinkKindID: linkKindID, CreatedAt: now, UpdatedAt: now,
	}
	if err := atlas.ValidateLink(link); err != nil {
		return atlas.Card{}, atlas.Link{}, err
	}
	return card, link, nil
}

// commitLinkedCardLocked appends+persists card/link together, rolling
// both back on a save failure -- unlocks a.mu itself (both call sites
// return straight through it) so the dataevent/notify calls below run
// unlocked, matching every other mutator in this package.
func (a *AtlasService) commitLinkedCardLocked(card atlas.Card, link atlas.Link) (atlas.Card, error) {
	a.cards = append(a.cards, card)
	a.links = append(a.links, link)
	perr := a.persistLocked()
	if perr != nil {
		a.links = a.links[:len(a.links)-1]
		a.cards = a.cards[:len(a.cards)-1]
	}
	a.mu.Unlock()
	if perr != nil {
		return atlas.Card{}, fmt.Errorf("save linked card: %w", perr)
	}
	dataevent.Emit("atlas", card.ID)
	dataevent.Emit("atlas", link.ID)
	a.notifyCardChange(card, "create", "")
	return card, nil
}
