// Package atlassvc is the Wails-facing layer over internal/domain/
// atlas -- storage/CRUD for Mill's Atlas surface (docs/adr/0038,
// docs/goals/0061): user-declared Kinds/LinkKinds, and the Cards/
// Links built from them. Domain validation stays in internal/domain/
// atlas (.claude/rules/backend.md's domain-purity rule); this package
// owns persistence, ID minting, referential-existence checks (a Kind/
// LinkKind/Card actually exists before something references it),
// containment-cycle rejection at the service boundary, seeding/
// reconcile, and the dataevent.Emit call on every successful mutation
// (docs/adr/0025, goal 0017's live-sync requirement).
package atlassvc

import (
	"encoding/json"
	"fmt"
	"sync"

	"github.com/alicoding/mill/internal/adapters/settings"
	"github.com/alicoding/mill/internal/domain/atlas"
)

// atlasStateKey is the single settings-store key holding every Atlas
// entity as one JSON blob (docs/goals/0061's Storage note) -- unlike
// compositionsvc/configuresvc's one-key-per-entity-type convention,
// Atlas's four entity families are small and mutually referential
// enough (a Card names a Kind; a Link names two Cards and a LinkKind)
// that one atomic blob is simpler than four independently-persisted
// slices that could drift out of sync with each other on a partial
// write.
const atlasStateKey = "atlas-v1"

// persistedState is atlasStateKey's on-disk shape.
type persistedState struct {
	Kinds     []atlas.Kind
	LinkKinds []atlas.LinkKind
	Cards     []atlas.Card
	Links     []atlas.Link
	// Lenses maps a container card's ID to its per-space density filter
	// (which Kind IDs stay hidden, and the depth/peek toggle) --
	// persisted server-side so it round-trips across sessions like
	// everything else here. atlas.LensSetting's own UnmarshalJSON keeps
	// a pre-goal-0061-slice-C bare-array entry loading correctly.
	Lenses map[string]atlas.LensSetting
}

// AtlasService holds Atlas's full in-memory state behind one mutex,
// same shape as GuardrailService/CompositionService.
type AtlasService struct {
	mu        sync.RWMutex
	store     settings.Store
	kinds     []atlas.Kind
	linkKinds []atlas.LinkKind
	cards     []atlas.Card
	links     []atlas.Link
	lenses    map[string]atlas.LensSetting
}

// NewAtlasService restores any persisted state, then reconciles the
// seeded example space into it (insert missing, upgrade unmodified,
// leave a user-modified seed alone, never resurrect a tombstoned one)
// -- runs on every startup, not just a fresh install, so a new example
// added later reaches an existing install too (.claude/rules/
// testing.md's seed top-up discipline).
func NewAtlasService(store settings.Store) *AtlasService {
	a := &AtlasService{store: store, lenses: map[string]atlas.LensSetting{}}
	a.restore()
	a.reconcileBuiltIns()
	return a
}

func (a *AtlasService) restore() {
	raw, ok := a.store.Get(atlasStateKey).(string)
	if !ok || raw == "" {
		return
	}
	var state persistedState
	if err := json.Unmarshal([]byte(raw), &state); err != nil {
		return
	}
	a.kinds = state.Kinds
	a.linkKinds = state.LinkKinds
	a.cards = state.Cards
	a.links = state.Links
	if state.Lenses != nil {
		a.lenses = state.Lenses
	}
}

// persistLocked marshals and saves the full state -- caller must hold
// a.mu (as a write lock; every mutator below persists while still
// holding it, same ordering compositionsvc/guardrailsvc use, so a
// concurrent reader can never observe a half-applied mutation).
func (a *AtlasService) persistLocked() error {
	state := persistedState{
		Kinds: a.kinds, LinkKinds: a.linkKinds,
		Cards: a.cards, Links: a.links, Lenses: a.lenses,
	}
	data, err := json.Marshal(state)
	if err != nil {
		return fmt.Errorf("marshal atlas state: %w", err)
	}
	if err := a.store.Set(atlasStateKey, string(data)); err != nil {
		return fmt.Errorf("persist atlas state: %w", err)
	}
	return nil
}

// --- read accessors ---

func (a *AtlasService) Kinds() []atlas.Kind {
	a.mu.RLock()
	defer a.mu.RUnlock()
	out := make([]atlas.Kind, len(a.kinds))
	copy(out, a.kinds)
	return out
}

func (a *AtlasService) LinkKinds() []atlas.LinkKind {
	a.mu.RLock()
	defer a.mu.RUnlock()
	out := make([]atlas.LinkKind, len(a.linkKinds))
	copy(out, a.linkKinds)
	return out
}

func (a *AtlasService) Cards() []atlas.Card {
	a.mu.RLock()
	defer a.mu.RUnlock()
	out := make([]atlas.Card, len(a.cards))
	copy(out, a.cards)
	return out
}

func (a *AtlasService) Links() []atlas.Link {
	a.mu.RLock()
	defer a.mu.RUnlock()
	out := make([]atlas.Link, len(a.links))
	copy(out, a.links)
	return out
}

// findKindLocked/findLinkKindLocked/findCardLocked/findLinkLocked
// return the index of the entity with id, or -1 -- callers must hold
// a.mu.

func (a *AtlasService) findKindLocked(id string) int {
	for i, k := range a.kinds {
		if k.ID == id {
			return i
		}
	}
	return -1
}

func (a *AtlasService) findLinkKindLocked(id string) int {
	for i, lk := range a.linkKinds {
		if lk.ID == id {
			return i
		}
	}
	return -1
}

func (a *AtlasService) findCardLocked(id string) int {
	for i, c := range a.cards {
		if c.ID == id {
			return i
		}
	}
	return -1
}

func (a *AtlasService) findLinkLocked(id string) int {
	for i, l := range a.links {
		if l.ID == id {
			return i
		}
	}
	return -1
}

// cardsByIDLocked snapshots the current card set keyed by ID -- the
// shape atlas.WouldCycle's ancestry walk needs. Caller must hold a.mu.
func (a *AtlasService) cardsByIDLocked() map[string]atlas.Card {
	byID := make(map[string]atlas.Card, len(a.cards))
	for _, c := range a.cards {
		byID[c.ID] = c
	}
	return byID
}
