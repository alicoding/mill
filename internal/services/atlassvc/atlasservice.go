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
	"log/slog"
	"slices"
	"sync"
	"time"

	"github.com/alicoding/mill/internal/adapters/settings"
	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/domain/typedfield"
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
	// Notes holds every quick-capture annotation (goal 0081 slice A1) --
	// its own family in the same atomic blob, never seeded/reconciled
	// (Note carries no BuiltIn/Seed provenance, deliberately: a scratch
	// annotation has none to protect).
	Notes []atlas.Note
	// Objects holds every board-local canvas object (goal 0179/0180:
	// image, ink, and any future kind declared the same way) -- its own
	// family, same never-seeded/reconciled posture Notes carries above
	// and for the same reason (no BuiltIn/Seed provenance to protect).
	Objects []atlas.BoardObject
	// Lenses maps a container card's ID to its per-space density filter
	// (which Kind IDs stay hidden, and the depth/peek toggle) --
	// persisted server-side so it round-trips across sessions like
	// everything else here. atlas.LensSetting's own UnmarshalJSON keeps
	// a pre-goal-0061-slice-C bare-array entry loading correctly.
	Lenses map[string]atlas.LensSetting
	// Session is the map's where-you-were (goal 0091) -- one entry,
	// not per-container.
	Session AtlasSessionState
	// Perspectives holds every named, ordered view over a space's live
	// card set (ADR-0041, goal 0095) -- zero entries means zero
	// behavior change: the default "everything" view is the ABSENCE of
	// a Perspective record, never an empty one.
	Perspectives []atlas.Perspective
}

// AtlasService holds Atlas's full in-memory state behind one mutex,
// same shape as GuardrailService/CompositionService.
type AtlasService struct {
	mu        sync.RWMutex
	store     settings.Store
	kinds     []atlas.Kind
	linkKinds []atlas.LinkKind
	// Paste-conversion seams (goal 0138) -- see WirePasteListWrites.
	pasteListFactory func(label string, columns []typedfield.Field) (string, error)
	pasteRowAppender func(listID string, values map[string]string) error
	cards     []atlas.Card
	links     []atlas.Link
	notes     []atlas.Note
	// objects holds every board-local canvas object (goal 0179/0180) --
	// same own-family posture as notes above.
	objects   []atlas.BoardObject
	lenses    map[string]atlas.LensSetting
	// mirrorsDir is the Mill-owned root directory a space's lazily-
	// created mirror folder lives under (goal 0063's share model,
	// atlasservice_share.go) -- set once from main.go via
	// SetMirrorsDir, empty ("" -- share actions report a configuration
	// error rather than writing beside the process) for any test that
	// never calls it.
	mirrorsDir string
	// capturesDir is the Mill-owned root directory a pasted image's
	// bytes land in (goal 0169 slice 2, atlasservice_imagecapture.go) --
	// set once from main.go via SetCapturesDir, empty ("" -- the paste
	// door reports a configuration error rather than writing beside the
	// process) for any test that never calls it, same posture
	// mirrorsDir takes above.
	capturesDir string
	// Recognition seams (goal 0126, atlasrecognition.go) -- injected
	// via WireSourceRecognition; nil (recognition simply off) for any
	// test that never wires them.
	integrationHosts integrationHostsFn
	offeredWorkflows offeredWorkflowsFn
	// List-projection seam (goal 0105, atlasprojection.go) -- injected
	// via WireListProjection, same nil-means-off discipline.
	listProjection listProjectionFn
	// guardedDataPaths are Mill's own settings/execution-db/backup
	// locations (main.go's own SetGuardedDataPaths call, goal 0067) --
	// ScanFolder/ImportFolderSuggestions refuse a picked folder that
	// contains, or is contained by, any of these, extending goal 0065's
	// synced-folder hazard to this picker. Empty for any test that
	// never calls the setter, same posture mirrorsDir takes.
	guardedDataPaths []string
	session          AtlasSessionState
	perspectives     []atlas.Perspective
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
	a.populateDenseFixture()
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
	// Self-heal duplicate links (goal 0124's inflated counts): the
	// same (from, to, kind) keeps only its first row, same one-time
	// in-place-migration posture as the RefreshWorkflowID block below
	// -- persisted lazily by whichever mutation runs next.
	a.links = dedupeLinks(state.Links)
	a.notes = state.Notes
	a.objects = state.Objects
	// One-time in-place migration (the MigrateLegacyEntries posture):
	// the single RefreshWorkflowID becomes the first attached action
	// (goal 0084) -- persisted lazily by whichever mutation runs next.
	for i := range a.cards {
		if rw := a.cards[i].RefreshWorkflowID; rw != "" {
			if !slices.Contains(a.cards[i].ActionWorkflowIDs, rw) {
				a.cards[i].ActionWorkflowIDs = append(a.cards[i].ActionWorkflowIDs, rw)
			}
			a.cards[i].RefreshWorkflowID = ""
		}
	}
	if state.Lenses != nil {
		a.lenses = state.Lenses
	}
	a.session = state.Session
	a.perspectives = state.Perspectives

	// Boot-time tombstone purge (goal 0093): unlocked here is safe --
	// restore only ever runs once, during construction, before the
	// service is shared across goroutines.
	if a.purgeTombstonesLocked(time.Now()) {
		if err := a.persistLocked(); err != nil {
			slog.Error("failed to persist atlas tombstone purge", "error", err)
		}
	}
}

// persistLocked marshals and saves the full state -- caller must hold
// a.mu (as a write lock; every mutator below persists while still
// holding it, same ordering compositionsvc/guardrailsvc use, so a
// concurrent reader can never observe a half-applied mutation).
func (a *AtlasService) persistLocked() error {
	state := persistedState{
		Kinds: a.kinds, LinkKinds: a.linkKinds,
		Cards: a.cards, Links: a.links, Notes: a.notes, Objects: a.objects, Lenses: a.lenses,
		Session: a.session, Perspectives: a.perspectives,
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

// Cards returns every LIVE card (goal 0093: a tombstoned card is
// excluded, and a live child of a tombstoned container carries its
// resolved effective ParentID -- see liveCardsLocked).
func (a *AtlasService) Cards() []atlas.Card {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.liveCardsLocked()
}

// Links returns every link whose endpoints are both LIVE cards (goal
// 0093: a link touching a tombstoned card is hidden, never removed).
func (a *AtlasService) Links() []atlas.Link {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.liveLinksLocked()
}

// Notes returns every LIVE quick-capture annotation (goal 0081 slice
// A1) -- its own family, deliberately never mixed into Cards(); goal
// 0093's tombstone exclusion applies the same way liveCardsLocked does.
func (a *AtlasService) Notes() []atlas.Note {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.liveNotesLocked()
}

// Objects returns every LIVE board-local canvas object (goal
// 0179/0180) -- its own family, deliberately never mixed into Cards()
// or Notes(); goal 0093's tombstone exclusion applies the same way
// liveCardsLocked/liveNotesLocked do.
func (a *AtlasService) Objects() []atlas.BoardObject {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.liveObjectsLocked()
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

func (a *AtlasService) findNoteLocked(id string) int {
	for i, n := range a.notes {
		if n.ID == id {
			return i
		}
	}
	return -1
}

func (a *AtlasService) findObjectLocked(id string) int {
	for i, o := range a.objects {
		if o.ID == id {
			return i
		}
	}
	return -1
}

func (a *AtlasService) findPerspectiveLocked(id string) int {
	for i, p := range a.perspectives {
		if p.ID == id {
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
