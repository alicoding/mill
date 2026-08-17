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
	if _, err := first.DeleteCard(deletable.ID); err != nil {
		t.Fatalf("DeleteCard: %v", err)
	}

	second := NewAtlasService(store)
	for _, c := range second.Cards() {
		if c.ID == deletable.ID {
			t.Errorf("reconcile resurrected tombstoned card %q", deletable.ID)
		}
	}
}

// leafCard returns a seeded card that is not itself a parent, so
// deleting it in a test never also promotes children this test isn't
// asserting about.
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

// TestReconcileBuiltIns_RetiredKindMigratesUserCards proves retiring a
// built-in Kind never strands or deletes a user's cards: a card the
// user created with the retired Kind is re-kinded to the replacement
// during reconcile, after which the retired Kind reaches zero
// references and is tombstoned -- on an EXISTING instance, not just a
// fresh install.
func TestReconcileBuiltIns_RetiredKindMigratesUserCards(t *testing.T) {
	store := servicetest.NewFakeStore()
	a := NewAtlasService(store)

	// Simulate the pre-retirement world: the retired Kind still exists
	// in the instance, with a user-created card referencing it.
	retiredID := atlas.RetiredBuiltInKindIDs()[0]
	replacementID, ok := atlas.RetiredKindReplacementID(retiredID)
	if !ok {
		t.Fatalf("RetiredKindReplacementID(%q) has no replacement", retiredID)
	}
	a.mu.Lock()
	a.kinds = append(a.kinds, atlas.Kind{ID: retiredID, Label: "Space"})
	a.cards = append(a.cards, atlas.Card{ID: "user-card-on-retired-kind", KindID: retiredID, Title: "Test"})
	if err := a.persistLocked(); err != nil {
		t.Fatalf("persistLocked: %v", err)
	}
	a.mu.Unlock()

	// A restart's reconcile pass must migrate the card and remove the Kind.
	b := NewAtlasService(store)
	for _, k := range b.Kinds() {
		if k.ID == retiredID {
			t.Fatalf("retired kind %q survived reconcile despite a migratable reference", retiredID)
		}
	}
	found := false
	for _, c := range b.Cards() {
		if c.ID == "user-card-on-retired-kind" {
			found = true
			if c.KindID != replacementID {
				t.Errorf("user card KindID = %q, want replacement %q", c.KindID, replacementID)
			}
		}
	}
	if !found {
		t.Fatal("user card was deleted by kind retirement; migration must preserve it")
	}
}

// TestReconcileBuiltIns_ScratchpadNoteUpgradesInPlace proves the goal
// 0081 slice A3 Scratchpad seed rework (Topic-card-with-instructional-
// text -> container-card-with-inbox-guidance) reaches an EXISTING
// instance, not just a fresh install: simulating a pre-upgrade
// instance still holding the old Note text at SeedRevision 1, a later
// reconcile pass must upgrade that card's Note in place to the current
// golden's text/revision, same as any other bumped built-in.
func TestReconcileBuiltIns_ScratchpadNoteUpgradesInPlace(t *testing.T) {
	store := servicetest.NewFakeStore()
	a := NewAtlasService(store)

	var scratchpadID string
	for _, c := range a.Cards() {
		if c.Title == "Scratchpad" {
			scratchpadID = c.ID
		}
	}
	if scratchpadID == "" {
		t.Fatal("no seeded Scratchpad card found")
	}

	// Roll the persisted copy back to the pre-upgrade shape a real
	// existing instance would still be carrying.
	a.mu.Lock()
	for i, c := range a.cards {
		if c.ID == scratchpadID {
			c.Note = "One keystroke in. File it later by dragging."
			c.Seed.SeedRevision = 1
			a.cards[i] = c
		}
	}
	if err := a.persistLocked(); err != nil {
		t.Fatalf("persistLocked: %v", err)
	}
	a.mu.Unlock()

	upgraded := NewAtlasService(store)
	var got atlas.Card
	found := false
	for _, c := range upgraded.Cards() {
		if c.ID == scratchpadID {
			got, found = c, true
		}
	}
	if !found {
		t.Fatal("Scratchpad card disappeared after reconcile")
	}
	want := "Quick captures land here. Drag notes out to file them, or promote them into cards."
	if got.Note != want {
		t.Errorf("Scratchpad Note = %q, want %q", got.Note, want)
	}
	if got.Seed.SeedRevision != 5 {
		t.Errorf("Scratchpad SeedRevision = %d, want 5", got.Seed.SeedRevision)
	}
}

// TestDenseFixture_EnvGatedAndIdempotent proves the stress space only
// appears when explicitly requested and never duplicates across
// restarts of the same instance.
func TestDenseFixture_EnvGatedAndIdempotent(t *testing.T) {
	countDense := func(a *AtlasService) int {
		n := 0
		for _, c := range a.Cards() {
			if len(c.ID) > 11 && c.ID[:11] == "atlas-dense" {
				n++
			}
		}
		return n
	}

	off := NewAtlasService(servicetest.NewFakeStore())
	if got := countDense(off); got != 0 {
		t.Fatalf("dense cards present without the env gate: %d", got)
	}

	t.Setenv("MILL_TEST_DENSE_ATLAS", "1")
	store := servicetest.NewFakeStore()
	a := NewAtlasService(store)
	first := countDense(a)
	if first == 0 {
		t.Fatal("env gate set but no dense cards populated")
	}
	b := NewAtlasService(store)
	if got := countDense(b); got != first {
		t.Fatalf("dense fixture duplicated across restart: %d then %d", first, got)
	}
}
