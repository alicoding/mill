package atlas

import (
	"fmt"
	"time"
)

// DenseFixture returns a deterministic, realistically-dense space --
// one parent area holding nested sub-areas, dozens of mixed-kind
// cards, and a web of cross-links -- for scale testing and dev
// stress runs. NOT a seed: no SeedRevision, no fingerprint, never
// reconciled; the service inserts it only when explicitly asked
// (MILL_TEST_DENSE_ATLAS) and only once per instance. Determinism
// matters more than realism here: identical input -> identical IDs,
// counts, and link topology, so scale tests can assert exact numbers.
func DenseFixture(parentID string, now time.Time) ([]Card, []Link) {
	var cards []Card
	var links []Link

	add := func(id string, kindID string, title string, parent string, note string) {
		cards = append(cards, Card{
			ID: "atlas-dense-" + id, KindID: kindID, Title: title, Note: note,
			ParentID: parent, ViewMode: ViewModeShelves,
			CreatedAt: now, UpdatedAt: now,
		})
	}

	add("velocity", kindTopicID, "Velocity", parentID, "The dense stress space.")
	// Arrivals never create overlap (goal 0073): the fixture roots its
	// frame clear of the seeded row (which ends ~y 290 at its tallest
	// derived size), not at the position-less default of the origin.
	cards[len(cards)-1].Position = &Position{X: 80, Y: 420}

	areas := []string{"Platform", "Payments", "Onboarding", "Risk"}
	kindCycle := []string{kindDocumentID, kindContactID, kindTopicID}
	for ai, area := range areas {
		areaID := fmt.Sprintf("area-%d", ai)
		add(areaID, kindTopicID, area, "atlas-dense-velocity", "")
		for ci := 0; ci < 12; ci++ {
			id := fmt.Sprintf("card-%d-%d", ai, ci)
			card := Card{
				ID: "atlas-dense-" + id, KindID: kindCycle[ci%len(kindCycle)],
				Title: fmt.Sprintf("%s item %d", area, ci+1),
				ParentID: "atlas-dense-" + areaID, ViewMode: ViewModeShelves,
				CreatedAt: now, UpdatedAt: now,
			}
			if ci%4 == 0 {
				card.Source = fmt.Sprintf("https://example.com/%s/%d", area, ci)
			}
			cards = append(cards, card)
		}
	}
	for i := 0; i < 8; i++ {
		add(fmt.Sprintf("loose-%d", i), kindCycle[i%len(kindCycle)],
			fmt.Sprintf("Velocity note %d", i+1), "atlas-dense-velocity", "")
	}

	link := func(id, from, to string) {
		links = append(links, Link{
			ID: "atlas-dense-link-" + id, FromCardID: from, ToCardID: to,
			LinkKindID: linkKindRelatesToID, CreatedAt: now, UpdatedAt: now,
		})
	}
	// Cross-area web: the i-th card of each area relates to the i-th
	// card of the next area, wrapping -- 4 areas x 6 = 24 links whose
	// endpoints sit BELOW the one-level preview from the parent board.
	for ai := range areas {
		next := (ai + 1) % len(areas)
		for ci := 0; ci < 6; ci++ {
			link(fmt.Sprintf("x-%d-%d", ai, ci),
				fmt.Sprintf("atlas-dense-card-%d-%d", ai, ci),
				fmt.Sprintf("atlas-dense-card-%d-%d", next, ci))
		}
	}
	// One deep card links OUT of the dense space entirely, to the
	// seeded "Getting started" card -- the reattachment case: from the
	// parent board this line must draw frame-to-card, not vanish.
	link("out", "atlas-dense-card-0-0", cardGettingID)

	return cards, links
}

// DenseFixtureParentID is where the service roots the fixture: the
// seeded "My space" card, so the dense space appears on the
// auto-entered landing board.
func DenseFixtureParentID() string { return cardMySpaceID }
