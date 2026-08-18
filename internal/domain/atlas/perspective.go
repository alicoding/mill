package atlas

import (
	"fmt"
	"strings"
	"time"

	"github.com/alicoding/mill/internal/domain/seedorigin"
)

// Perspective is a named, ordered view over one container's (SpaceID's)
// live card set (ADR-0041, goal 0095): membership is explicit and
// stored -- both which cards (MemberCardIDs) and which links
// (MemberLinkIDs) render in this view -- never derived from a query,
// so a target-state connection between two currently-existing systems
// can never leak into a view it wasn't deliberately added to. The
// default "everything" view is the ABSENCE of a Perspective record:
// zero Perspectives over a space means zero behavior change. Order
// places this perspective within its SpaceID's own ordered set (e.g.
// "Current", "Interim", "Target"); it is meaningless compared across
// different SpaceID values. Deliberately carries NO DeletedAt --
// unlike Card/Note (goal 0093's soft-delete-with-undo), a Perspective
// delete is immediate: cheap to recreate, so no tombstone/undo
// lifecycle exists for it in v1.
type Perspective struct {
	ID          string
	SpaceID     string
	Name        string
	Description string
	Order       int
	// MemberCardIDs is the stored set of cards this perspective shows.
	// Closed under ancestry by the service layer's AddToPerspective (a
	// member's containing chain up to SpaceID joins with it), never by
	// this package -- membership mutation is a service concern.
	MemberCardIDs []string
	// MemberLinkIDs is the stored set of links this perspective shows.
	// A link still only actually RENDERS when both its endpoints are
	// ALSO members -- see FilterByPerspective.
	MemberLinkIDs []string
	CreatedAt     time.Time
	UpdatedAt     time.Time
	BuiltIn       bool
	Seed          seedorigin.Origin
}

// ValidatePerspective checks p is well-formed: a non-empty Name, and
// every member card spatially consistent with SpaceID -- actually
// inside the subtree SpaceID roots (AncestorChain returning non-nil),
// or SpaceID == "" (the true root, under which every card lives).
// byID must map every existing card's ID to itself (the service
// layer's full card set, the same convention WouldCycle's own ancestry
// walk uses); whether SpaceID itself names an existing card is
// referential-existence checking, left to the service layer per
// docs/goals/0061's Validation note.
func ValidatePerspective(p Perspective, byID map[string]Card) error {
	if strings.TrimSpace(p.Name) == "" {
		return fmt.Errorf("a perspective needs a name")
	}
	for _, cardID := range p.MemberCardIDs {
		if AncestorChain(byID, cardID, p.SpaceID) == nil {
			return fmt.Errorf("card %q is not inside space %q", cardID, p.SpaceID)
		}
	}
	return nil
}

// AncestorChain returns every card between cardID and SpaceID,
// exclusive of spaceID itself, inclusive of cardID, ordered from
// SpaceID's nearest child down to cardID -- the exact set ADR-0041's
// ancestry-closure rule adds to a perspective's membership in one step
// (AddToPerspective, and authoring-while-active), so a deeply nested
// card never appears in a filtered view floating with no visible
// container. spaceID == "" names the true root, which contains every
// card. Returns nil (never an empty non-nil slice for a genuine miss)
// when cardID does not actually live inside spaceID's subtree, or when
// a cycle elsewhere in the data makes the walk unable to terminate --
// the caller's uniform signal to skip the add entirely. cardID ==
// spaceID returns a non-nil empty slice: valid (the space contains
// itself), nothing to add.
func AncestorChain(byID map[string]Card, cardID, spaceID string) []string {
	if cardID == "" {
		return nil
	}
	chain := []string{}
	seen := make(map[string]bool)
	cur := cardID
	for {
		if seen[cur] {
			return nil
		}
		seen[cur] = true
		chain = append(chain, cur)
		if cur == spaceID {
			break
		}
		c, ok := byID[cur]
		if !ok {
			return nil
		}
		if c.ParentID == "" {
			if spaceID == "" {
				break // reached the true root, and spaceID IS the true root
			}
			return nil // walked off the root without ever finding spaceID
		}
		cur = c.ParentID
	}
	if spaceID != "" {
		chain = chain[:len(chain)-1] // drop spaceID itself -- never a member of its own view
	}
	for i, j := 0, len(chain)-1; i < j; i, j = i+1, j-1 {
		chain[i], chain[j] = chain[j], chain[i]
	}
	return chain
}

// DescendantsAndSelf returns cardID together with every card reachable
// by following ParentID links downward from it (its full containment
// subtree) -- the set RemoveFromPerspective's cascade removes in one
// step: a member card left behind after its own container drops out of
// a view would render with no visible parent context, so removing a
// container removes what it holds too.
func DescendantsAndSelf(byID map[string]Card, cardID string) map[string]bool {
	out := map[string]bool{cardID: true}
	childrenOf := make(map[string][]string, len(byID))
	for id, c := range byID {
		childrenOf[c.ParentID] = append(childrenOf[c.ParentID], id)
	}
	queue := []string{cardID}
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		for _, child := range childrenOf[cur] {
			if !out[child] {
				out[child] = true
				queue = append(queue, child)
			}
		}
	}
	return out
}

// FilterByPerspective returns the subset of cards that are members of
// p, and the subset of links that RENDER under p: a link renders iff
// the link itself AND both its endpoints are members (ADR-0041's
// stored-not-derived link-membership rule) -- guards a target-state
// connection between two currently-existing systems from leaking into
// a perspective it was never added to. Input order is preserved in
// both outputs. Pure: never mutates cards, links, or p. Callers pass
// already-live (non-tombstoned) cards/links -- a member id naming a
// tombstoned/purged entity simply matches nothing and is silently
// excluded, the same posture every other Atlas read surface takes.
func FilterByPerspective(cards []Card, links []Link, p Perspective) ([]Card, []Link) {
	memberCards := make(map[string]bool, len(p.MemberCardIDs))
	for _, id := range p.MemberCardIDs {
		memberCards[id] = true
	}
	memberLinks := make(map[string]bool, len(p.MemberLinkIDs))
	for _, id := range p.MemberLinkIDs {
		memberLinks[id] = true
	}
	outCards := make([]Card, 0, len(cards))
	for _, c := range cards {
		if memberCards[c.ID] {
			outCards = append(outCards, c)
		}
	}
	outLinks := make([]Link, 0, len(links))
	for _, l := range links {
		if memberLinks[l.ID] && memberCards[l.FromCardID] && memberCards[l.ToCardID] {
			outLinks = append(outLinks, l)
		}
	}
	return outCards, outLinks
}

// PerspectiveDiff is the computable diff between two perspectives
// sharing the same live card set (ADR-0041's O(1) reference-
// architecture property, docs/goals/0095): pure set difference over
// stored membership, nothing derived or stored on disk. Re-parenting
// is deliberately never expressed here -- a card carries exactly one
// ParentID shared by every perspective, so containment itself can
// never differ per view (ADR-0041's own invariant; a revisit needs its
// own ADR).
type PerspectiveDiff struct {
	AddedCardIDs   []string
	RemovedCardIDs []string
	AddedLinkIDs   []string
	RemovedLinkIDs []string
}

// DiffPerspectives computes what changed moving from -> to: a member
// present in "to" but not "from" is added, present in "from" but not
// "to" is removed. Order-stable: added ids follow "to"'s own
// MemberCardIDs/MemberLinkIDs order, removed ids follow "from"'s.
func DiffPerspectives(from, to Perspective) PerspectiveDiff {
	return PerspectiveDiff{
		AddedCardIDs:   setDiff(to.MemberCardIDs, from.MemberCardIDs),
		RemovedCardIDs: setDiff(from.MemberCardIDs, to.MemberCardIDs),
		AddedLinkIDs:   setDiff(to.MemberLinkIDs, from.MemberLinkIDs),
		RemovedLinkIDs: setDiff(from.MemberLinkIDs, to.MemberLinkIDs),
	}
}

// setDiff returns every id in a that is not in b, preserving a's order.
func setDiff(a, b []string) []string {
	inB := make(map[string]bool, len(b))
	for _, id := range b {
		inB[id] = true
	}
	out := []string{}
	for _, id := range a {
		if !inB[id] {
			out = append(out, id)
		}
	}
	return out
}
