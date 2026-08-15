package atlassvc

import (
	"testing"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// TestReconcileBuiltIns_SeedsFreshInstall proves the seeded example
// space (ADR-0038's "My space" root + example Kinds/LinkKinds/Cards/
// Links) lands on a fresh, empty store -- the seed IS the proof
// (.claude/rules/testing.md) that Atlas's own domain shapes actually
// compose end to end, not just in isolated unit tests.
func TestReconcileBuiltIns_SeedsFreshInstall(t *testing.T) {
	a := NewAtlasService(servicetest.NewFakeStore())

	if got, want := len(a.Kinds()), len(atlas.BuiltInKinds()); got != want {
		t.Errorf("Kinds() count = %d, want %d", got, want)
	}
	if got, want := len(a.LinkKinds()), len(atlas.BuiltInLinkKinds()); got != want {
		t.Errorf("LinkKinds() count = %d, want %d", got, want)
	}
	if got, want := len(a.Cards()), len(atlas.BuiltInCards()); got != want {
		t.Errorf("Cards() count = %d, want %d", got, want)
	}
	if got, want := len(a.Links()), len(atlas.BuiltInLinks()); got != want {
		t.Errorf("Links() count = %d, want %d", got, want)
	}
}

// TestReconcileBuiltIns_SecondRunIsIdempotent proves reconcile is
// top-up, not insert-always: constructing a second AtlasService over
// the SAME store (simulating a restart) must not duplicate any seeded
// entity.
func TestReconcileBuiltIns_SecondRunIsIdempotent(t *testing.T) {
	store := servicetest.NewFakeStore()
	first := NewAtlasService(store)
	firstKinds, firstLinkKinds := len(first.Kinds()), len(first.LinkKinds())
	firstCards, firstLinks := len(first.Cards()), len(first.Links())

	second := NewAtlasService(store)

	if got := len(second.Kinds()); got != firstKinds {
		t.Errorf("Kinds() count after second reconcile = %d, want %d (no duplicates)", got, firstKinds)
	}
	if got := len(second.LinkKinds()); got != firstLinkKinds {
		t.Errorf("LinkKinds() count after second reconcile = %d, want %d (no duplicates)", got, firstLinkKinds)
	}
	if got := len(second.Cards()); got != firstCards {
		t.Errorf("Cards() count after second reconcile = %d, want %d (no duplicates)", got, firstCards)
	}
	if got := len(second.Links()); got != firstLinks {
		t.Errorf("Links() count after second reconcile = %d, want %d (no duplicates)", got, firstLinks)
	}
}

// TestReconcileBuiltIns_RespectsTombstone proves a deliberately deleted
// seeded Card is never resurrected by a later reconcile pass -- the
// same delete-tombstone discipline every other seeded entity family in
// this codebase already carries.
func TestReconcileBuiltIns_RespectsTombstone(t *testing.T) {
	store := servicetest.NewFakeStore()
	first := NewAtlasService(store)

	deletable := leafCard(t, first.Cards())
	if err := first.DeleteCard(deletable.ID); err != nil {
		t.Fatalf("DeleteCard: %v", err)
	}

	second := NewAtlasService(store)
	for _, c := range second.Cards() {
		if c.ID == deletable.ID {
			t.Errorf("reconcile resurrected tombstoned card %q", deletable.ID)
		}
	}
}

// leafCard returns a seeded card that is not itself a parent -- safe
// for DeleteCard's own no-orphaning rule (blocked while it still has
// children).
func leafCard(t *testing.T, cards []atlas.Card) atlas.Card {
	t.Helper()
	hasChild := make(map[string]bool, len(cards))
	for _, c := range cards {
		if c.ParentID != "" {
			hasChild[c.ParentID] = true
		}
	}
	for _, c := range cards {
		if !hasChild[c.ID] {
			return c
		}
	}
	t.Fatal("every seeded card is a parent -- test fixture needs a leaf")
	return atlas.Card{}
}
