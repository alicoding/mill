package atlassvc

import (
	"log/slog"
	"os"
	"time"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/domain/seedorigin"
	"github.com/alicoding/mill/internal/services/seeding"
)

// reconcileBuiltIns runs the full insert/upgrade/leave-alone/skip-
// tombstoned algorithm (docs/goals/0037) across all four Atlas entity
// families in one pass, in dependency order (Kinds and LinkKinds
// before Cards/Links, since a seeded Card/Link names them) -- then
// persists once if anything changed, same "no phantom in-memory seed
// a restart would silently drop" discipline every other reconcile in
// this codebase already follows. Unlike ConfigureService's per-entity-
// key reconcile functions, this one mutates the single shared state
// this package persists as one blob (atlasStateKey), so all four
// families share one changed flag and one final persist.
// populateDenseFixture inserts the deterministic stress space (goal
// 0073) exactly once per instance, only when MILL_TEST_DENSE_ATLAS is
// set -- the scale layer of the test pyramid, never a seed: no
// SeedRevision, no fingerprint, invisible to reconcile.
func (a *AtlasService) populateDenseFixture() {
	if os.Getenv("MILL_TEST_DENSE_ATLAS") == "" {
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, c := range a.cards {
		if c.ID == "atlas-dense-velocity" {
			return
		}
	}
	cards, links := atlas.DenseFixture(atlas.DenseFixtureParentID(), time.Now())
	a.cards = append(a.cards, cards...)
	a.links = append(a.links, links...)
	if err := a.persistLocked(); err != nil {
		slog.Error("failed to persist dense Atlas fixture", "error", err)
	}
}

func (a *AtlasService) reconcileBuiltIns() {
	tombstones := seeding.LoadTombstones(a.store)
	now := time.Now()
	a.mu.Lock()
	changed := false
	changed = a.reconcileKindsLocked(tombstones, now) || changed
	changed = a.reconcileLinkKindsLocked(tombstones, now) || changed
	changed = a.reconcileCardsLocked(tombstones, now) || changed
	changed = a.reconcileLinksLocked(tombstones, now) || changed
	changed = a.reconcilePerspectivesLocked(tombstones, now) || changed
	// Retirement runs LAST, after cards have already been re-kinded off
	// a retired Kind by the upgrade path above -- reference integrity
	// (no Card may still name a Kind being removed) is checked against
	// that already-updated card set, never the pre-reconcile one.
	changed = a.retireGoneKindsLocked() || changed
	changed = a.retireGoneSeedsLocked() || changed
	if changed {
		if err := a.persistLocked(); err != nil {
			slog.Error("failed to reconcile built-in Atlas entities", "error", err)
		}
	}
	a.mu.Unlock()
}

func (a *AtlasService) reconcileKindsLocked(tombstones map[string]bool, now time.Time) bool {
	byID := make(map[string]int, len(a.kinds))
	for i, k := range a.kinds {
		byID[k.ID] = i
	}
	changed := false
	for _, golden := range atlas.BuiltInKinds() {
		idx, present := byID[golden.ID]
		if !present {
			if tombstones[golden.ID] {
				continue
			}
			golden.CreatedAt, golden.UpdatedAt = now, now
			a.kinds = append(a.kinds, golden)
			changed = true
			continue
		}
		existing := a.kinds[idx]
		if existing.Seed.SeedRevision == 0 {
			existing.Seed = seedorigin.Origin{SeedRevision: golden.Seed.SeedRevision, Modified: true}
			a.kinds[idx] = existing
			changed = true
			continue
		}
		if existing.Seed.Modified {
			continue
		}
		if existing.Seed.SeedRevision < golden.Seed.SeedRevision {
			golden.CreatedAt, golden.UpdatedAt = existing.CreatedAt, now
			golden.Seed = seedorigin.Stamp(golden.Seed.SeedRevision)
			a.kinds[idx] = golden
			changed = true
		}
	}
	return changed
}

func (a *AtlasService) reconcileLinkKindsLocked(tombstones map[string]bool, now time.Time) bool {
	byID := make(map[string]int, len(a.linkKinds))
	for i, lk := range a.linkKinds {
		byID[lk.ID] = i
	}
	changed := false
	for _, golden := range atlas.BuiltInLinkKinds() {
		idx, present := byID[golden.ID]
		if !present {
			if tombstones[golden.ID] {
				continue
			}
			golden.CreatedAt, golden.UpdatedAt = now, now
			a.linkKinds = append(a.linkKinds, golden)
			changed = true
			continue
		}
		existing := a.linkKinds[idx]
		if existing.Seed.SeedRevision == 0 {
			existing.Seed = seedorigin.Origin{SeedRevision: golden.Seed.SeedRevision, Modified: true}
			a.linkKinds[idx] = existing
			changed = true
			continue
		}
		if existing.Seed.Modified {
			continue
		}
		if existing.Seed.SeedRevision < golden.Seed.SeedRevision {
			golden.CreatedAt, golden.UpdatedAt = existing.CreatedAt, now
			golden.Seed = seedorigin.Stamp(golden.Seed.SeedRevision)
			a.linkKinds[idx] = golden
			changed = true
		}
	}
	return changed
}

func (a *AtlasService) reconcileCardsLocked(tombstones map[string]bool, now time.Time) bool {
	byID := make(map[string]int, len(a.cards))
	for i, c := range a.cards {
		byID[c.ID] = i
	}
	changed := false
	for _, golden := range atlas.BuiltInCards() {
		idx, present := byID[golden.ID]
		if !present {
			if tombstones[golden.ID] {
				continue
			}
			golden.CreatedAt, golden.UpdatedAt = now, now
			a.cards = append(a.cards, golden)
			changed = true
			continue
		}
		existing := a.cards[idx]
		// A currently-tombstoned card (goal 0093) is left untouched --
		// top-up seeding must never resurrect/upgrade it in place while
		// it's soft-deleted; UndoDelete or the boot-time purge are the
		// only paths that change it from here.
		if !existing.DeletedAt.IsZero() {
			continue
		}
		if existing.Seed.SeedRevision == 0 {
			existing.Seed = seedorigin.Origin{SeedRevision: golden.Seed.SeedRevision, Modified: true}
			a.cards[idx] = existing
			changed = true
			continue
		}
		if existing.Seed.Modified {
			continue
		}
		if existing.Seed.SeedRevision < golden.Seed.SeedRevision {
			golden.CreatedAt, golden.UpdatedAt = existing.CreatedAt, now
			golden.Seed = seedorigin.Stamp(golden.Seed.SeedRevision)
			a.cards[idx] = golden
			changed = true
		}
	}
	return changed
}

// retireGoneKindsLocked removes/tombstones every Kind named by
// atlas.RetiredBuiltInKindIDs that's still sitting in a.kinds, EXACTLY
// when no Card references it anymore -- the same reference-integrity
// guard DeleteKind enforces for a user-initiated delete, applied here
// automatically during reconcile. A Kind still referenced (e.g. a
// user-Modified card the upgrade path above skipped re-kinding) is
// left in place rather than forced: reconcile never orphans a Card's
// KindID, it just leaves the retirement pending until that reference
// clears some other way.
func (a *AtlasService) retireGoneKindsLocked() bool {
	changed := false
	for _, id := range atlas.RetiredBuiltInKindIDs() {
		idx := -1
		for i, k := range a.kinds {
			if k.ID == id {
				idx = i
				break
			}
		}
		if idx == -1 {
			continue
		}
		// Retirement must never strand a user's cards on a Kind that's
		// going away: every remaining reference (seeded or user-created)
		// migrates to the retired Kind's designated replacement first,
		// so the tombstone below always operates on zero references. A
		// retired Kind with no replacement mapping stays put -- refusing
		// beats deleting data out from under its cards.
		replacementID, hasReplacement := atlas.RetiredKindReplacementID(id)
		stillReferenced := false
		for i := range a.cards {
			if a.cards[i].KindID != id {
				continue
			}
			if !hasReplacement {
				stillReferenced = true
				break
			}
			a.cards[i].KindID = replacementID
			a.cards[i].UpdatedAt = time.Now()
			changed = true
		}
		if stillReferenced {
			continue
		}
		if err := seeding.RecordTombstone(a.store, id); err != nil {
			slog.Error("failed to tombstone retired built-in Atlas kind", "id", id, "error", err)
			continue
		}
		a.kinds = append(a.kinds[:idx], a.kinds[idx+1:]...)
		changed = true
	}
	return changed
}

func (a *AtlasService) reconcileLinksLocked(tombstones map[string]bool, now time.Time) bool {
	byID := make(map[string]int, len(a.links))
	for i, l := range a.links {
		byID[l.ID] = i
	}
	changed := false
	for _, golden := range atlas.BuiltInLinks() {
		idx, present := byID[golden.ID]
		if !present {
			if tombstones[golden.ID] {
				continue
			}
			golden.CreatedAt, golden.UpdatedAt = now, now
			a.links = append(a.links, golden)
			changed = true
			continue
		}
		existing := a.links[idx]
		if existing.Seed.SeedRevision == 0 {
			existing.Seed = seedorigin.Origin{SeedRevision: golden.Seed.SeedRevision, Modified: true}
			a.links[idx] = existing
			changed = true
			continue
		}
		if existing.Seed.Modified {
			continue
		}
		if existing.Seed.SeedRevision < golden.Seed.SeedRevision {
			golden.CreatedAt, golden.UpdatedAt = existing.CreatedAt, now
			golden.Seed = seedorigin.Stamp(golden.Seed.SeedRevision)
			a.links[idx] = golden
			changed = true
		}
	}
	return changed
}

// reconcilePerspectivesLocked mirrors reconcileLinksLocked's insert/
// upgrade/leave-alone-once-Modified/skip-tombstoned algorithm for
// Perspectives (goal 0095): tops up the seeded three-perspective
// reference-architecture example onto an existing install exactly
// like every other family already does.
func (a *AtlasService) reconcilePerspectivesLocked(tombstones map[string]bool, now time.Time) bool {
	byID := make(map[string]int, len(a.perspectives))
	for i, p := range a.perspectives {
		byID[p.ID] = i
	}
	changed := false
	for _, golden := range atlas.BuiltInPerspectives() {
		idx, present := byID[golden.ID]
		if !present {
			if tombstones[golden.ID] {
				continue
			}
			golden.CreatedAt, golden.UpdatedAt = now, now
			a.perspectives = append(a.perspectives, golden)
			changed = true
			continue
		}
		existing := a.perspectives[idx]
		if existing.Seed.SeedRevision == 0 {
			existing.Seed = seedorigin.Origin{SeedRevision: golden.Seed.SeedRevision, Modified: true}
			a.perspectives[idx] = existing
			changed = true
			continue
		}
		if existing.Seed.Modified {
			continue
		}
		if existing.Seed.SeedRevision < golden.Seed.SeedRevision {
			golden.CreatedAt, golden.UpdatedAt = existing.CreatedAt, now
			golden.Seed = seedorigin.Stamp(golden.Seed.SeedRevision)
			a.perspectives[idx] = golden
			changed = true
		}
	}
	return changed
}


// retireGoneSeedsLocked removes retired built-in cards, links, and
// perspectives (the de-seeded reference-architecture landscape) from an
// existing install -- exactly when the record is still an untouched
// golden (seed origin present, Modified false). A user-edited copy is
// the user's data and stays; either way a tombstone is recorded so
// reconcile can never re-add the retired golden. Links whose retired
// endpoints leave first are removed by the card pass's own link sweep,
// so ordering inside this function is links, then child cards, then
// their container, then perspectives.
func (a *AtlasService) retireGoneSeedsLocked() bool {
	changed := false
	retire := func(id string) {
		if err := seeding.RecordTombstone(a.store, id); err != nil {
			slog.Error("failed to tombstone retired built-in Atlas seed", "id", id, "error", err)
		}
	}
	for _, id := range atlas.RetiredBuiltInLinkIDs() {
		for i, l := range a.links {
			if l.ID != id {
				continue
			}
			if l.Seed.IsSeeded() && !l.Seed.Modified {
				a.links = append(a.links[:i], a.links[i+1:]...)
				retire(id)
				changed = true
			}
			break
		}
	}
	for _, id := range atlas.RetiredBuiltInCardIDs() {
		for i, c := range a.cards {
			if c.ID != id {
				continue
			}
			if !c.Seed.IsSeeded() || c.Seed.Modified || !c.DeletedAt.IsZero() {
				break
			}
			// Never orphan: anything still inside the retiring card
			// (a user's own note or card filed there) promotes to the
			// retiring card's own parent first.
			for j := range a.cards {
				if a.cards[j].ParentID == id {
					a.cards[j].ParentID = c.ParentID
					a.cards[j].UpdatedAt = time.Now()
				}
			}
			for j := range a.notes {
				if a.notes[j].ParentID == id {
					a.notes[j].ParentID = c.ParentID
					a.notes[j].UpdatedAt = time.Now()
				}
			}
			// Any remaining link touching the card goes with it.
			kept := a.links[:0]
			for _, l := range a.links {
				if l.FromCardID != id && l.ToCardID != id {
					kept = append(kept, l)
				}
			}
			a.links = kept
			a.cards = append(a.cards[:i], a.cards[i+1:]...)
			retire(id)
			changed = true
			break
		}
	}
	for _, id := range atlas.RetiredBuiltInPerspectiveIDs() {
		for i, p := range a.perspectives {
			if p.ID != id {
				continue
			}
			if p.Seed.IsSeeded() && !p.Seed.Modified {
				a.perspectives = append(a.perspectives[:i], a.perspectives[i+1:]...)
				retire(id)
				changed = true
			}
			break
		}
	}
	return changed
}
