package atlassvc

import (
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/domain/seedorigin"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// The de-seeded reference architecture: an install still carrying the
// previously-shipped landscape (cards/links/perspectives as untouched
// goldens) loses them on reconcile with tombstones recorded, while a
// user-MODIFIED copy stays -- concepts are user-authored, only the
// capability ships.
func TestReconcile_RetiresLandscapeSeeds(t *testing.T) {
	store := servicetest.NewFakeStore()
	a := NewAtlasService(store)

	// Simulate the old install state: re-add the retired goldens as
	// untouched seeds, except one card the user modified.
	a.mu.Lock()
	now := time.Now()
	mkCard := func(id, title string, modified bool) atlas.Card {
		return atlas.Card{ID: id, KindID: "atlas-kind-component", Title: title, ParentID: "atlas-card-my-space",
			CreatedAt: now, UpdatedAt: now, BuiltIn: true,
			Seed: seedorigin.Origin{SeedRevision: 1, Modified: modified}}
	}
	a.cards = append(a.cards,
		mkCard("atlas-card-system-landscape", "System landscape", false),
		mkCard("atlas-card-web-app", "Web app", true), // user touched this one
		mkCard("atlas-card-data-store", "Data store", false),
	)
	a.links = append(a.links, atlas.Link{ID: "atlas-link-web-to-store",
		FromCardID: "atlas-card-web-app", ToCardID: "atlas-card-data-store",
		LinkKindID: "atlas-linkkind-relates-to", CreatedAt: now, UpdatedAt: now,
		BuiltIn: true, Seed: seedorigin.Stamp(1)})
	a.perspectives = append(a.perspectives, atlas.Perspective{ID: "atlas-perspective-current",
		SpaceID: "atlas-card-system-landscape", Name: "Current",
		CreatedAt: now, UpdatedAt: now, BuiltIn: true, Seed: seedorigin.Stamp(1)})
	a.mu.Unlock()

	a.reconcileBuiltIns()

	byID := map[string]bool{}
	for _, c := range a.Cards() {
		byID[c.ID] = true
	}
	if byID["atlas-card-system-landscape"] || byID["atlas-card-data-store"] {
		t.Error("untouched retired goldens must be removed")
	}
	if !byID["atlas-card-web-app"] {
		t.Error("a user-modified copy must stay")
	}
	for _, l := range a.Links() {
		if l.ID == "atlas-link-web-to-store" {
			t.Error("retired seeded link must be removed")
		}
	}
	for _, p := range a.Perspectives() {
		if p.ID == "atlas-perspective-current" {
			t.Error("retired seeded perspective must be removed")
		}
	}

	// Reconcile again: tombstones keep them gone, nothing re-adds.
	a.reconcileBuiltIns()
	count := 0
	for _, c := range a.Cards() {
		if c.ID == "atlas-card-system-landscape" {
			count++
		}
	}
	if count != 0 {
		t.Error("tombstoned golden re-appeared on second reconcile")
	}
}
