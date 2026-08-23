package atlassvc

import (
	"fmt"
	"path/filepath"
	"sort"
	"strings"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/services/seeding"
)

// This file is synced-folder onboarding's write half (docs/goals/0067,
// generalized by goal 0178 S1): ImportFolderSuggestions is the only
// place a folder-scan suggestion becomes a real card -- mirroring
// ImportAtlas's own preview/nothing-written-until-confirm shape
// (atlasservice_export.go). Split out of atlasservice_folderscan.go
// along the preview/write seam so neither file crowds the 500-line cap.

// ImportFolderSuggestionsRequest is ImportFolderSuggestions' own input:
// which of a fresh ScanFolder(root)'s entries to accept, and which
// existing Kind each ScanCategory's accepted entries become -- a Kind
// choice the user makes in the preview (ADR-0038 Decision 2: nothing
// here may assume a specific Kind exists).
type ImportFolderSuggestionsRequest struct {
	Root string
	// TargetParentID is the containing card every root-level accepted
	// entry (and any accepted entry whose own parent directory wasn't
	// itself accepted) lands under -- "" for the true root. The
	// caller's own current space, per goal 0067's "default: current
	// space".
	TargetParentID string
	// AcceptedRelPaths names every FolderScanEntry.RelPath the user
	// kept -- everything else from the fresh re-scan is simply never
	// created.
	AcceptedRelPaths []string
	// CategoryKindIDs maps an atlas.ScanCategory value ("file"/
	// "image"/"container") to the Kind ID its accepted entries are
	// created as -- required for every category actually present among
	// AcceptedRelPaths.
	CategoryKindIDs map[string]string
}

// FolderImportSummary counts what ImportFolderSuggestions actually
// created (never what it merely reused/refreshed on a re-import).
type FolderImportSummary struct {
	CardsCreated      int
	ContainersCreated int
}

// ImportFolderSuggestions is the only place a folder-scan suggestion
// becomes a real card -- goal 0067's preview/confirm boundary. It
// RE-SCANS root itself (bounded, same caps ScanFolder uses) rather
// than trusting the frontend's own copy of the tree back: a stale
// preview (the folder changed between scan and confirm) then fails
// closed on whatever no longer matches AcceptedRelPaths, instead of
// importing something the user never actually saw. Containers are
// created before their own children (ordered by path depth) so
// containment always resolves to a real card id; an accepted entry
// whose own parent directory was NOT accepted attaches directly under
// TargetParentID instead of being dropped.
//
// A FILE entry is synced through the same syncMirrorCard primitive
// SyncLedgerFolder uses (goal 0178 S1): keyed by its own absolute
// MirrorPath, an existing card there is refreshed in place (checksum
// updated, and its Kind's coerced frontmatter fields re-merged --
// atlas.CoerceFrontmatterFields, MergeCardFields -- so a Kind field the
// file doesn't carry, an owner-owned value like a proposed status,
// stays untouched by construction, goal 0172 S1), and re-importing an
// unchanged file is a pure no-op.
//
// The match is scoped to the entry's own freshly-resolved PARENT
// (scopedMirrorLookup), never the whole atlas: goal 0088 already lets a
// user import matching content into a DIFFERENT space on purpose (the
// duplicate flag is advisory, never blocking), and that must keep
// creating its own independent card there, not silently merge into a
// card living somewhere else entirely.
//
// A DIRECTORY entry (goal 0178 S2) now carries a MirrorPath too -- its
// own source folder -- so a container is resolved through the exact
// same scopedMirrorLookup identity as a file: re-importing a NESTED
// folder into the same target reuses the existing container's id
// instead of recreating it, which is what makes everything below it
// resolve to the SAME parent on every run and therefore idempotent all
// the way down, not just at the root level. Giving a container a
// MirrorPath also turns on the mirror-file UI (freshness dot, reveal-
// in-Finder) for it -- the deliberate S2 design decision, since a
// container mirroring a folder is just as real a stale-able snapshot
// as a file mirroring one, more so: a folder can gain and lose members
// while every file inside it stays byte-identical.
func (a *AtlasService) ImportFolderSuggestions(req ImportFolderSuggestionsRequest) (FolderImportSummary, error) {
	a.mu.RLock()
	guardErr := a.guardSyncedFolderLocked(req.Root)
	a.mu.RUnlock()
	if guardErr != nil {
		return FolderImportSummary{}, guardErr
	}

	scanned, err := a.ScanFolder(req.Root)
	if err != nil {
		return FolderImportSummary{}, err
	}

	ordered := acceptedEntriesByDepth(scanned.Entries, req.AcceptedRelPaths)
	targetIsCanvas := a.cardIsCanvas(req.TargetParentID)
	kindsByID := a.kindsByIDIndex()
	byMirror := a.mirrorIndex()

	var summary FolderImportSummary
	cardIDByRelPath := make(map[string]string, len(ordered))
	rootLevelIndex := 0
	for _, e := range ordered {
		parentCardID, atTarget := resolveImportParent(e, req.TargetParentID, cardIDByRelPath)
		kindID := req.CategoryKindIDs[string(e.Category)]
		if kindID == "" {
			return summary, fmt.Errorf("no target kind chosen for %q entries", e.Category)
		}
		// A card created with a nil Position renders at its parent
		// canvas's own origin (AtlasCanvasSpace.tsx's own documented
		// default) -- fine for the ONE card that convention already
		// assumes, but this batch can land many entries directly under
		// TargetParentID at once, so every root-level entry (never a
		// nested one, which always lands in a freshly-created
		// shelves-mode container instead) gets its own grid slot when
		// TargetParentID itself renders as canvas.
		var position *atlas.Position
		if atTarget && targetIsCanvas {
			position = importGridPosition(rootLevelIndex)
			rootLevelIndex++
		}
		entry := buildImportMirrorEntry(req.Root, e, kindID, parentCardID, position, kindsByID)
		lookup := scopedMirrorLookup(byMirror, entry.MirrorPath, parentCardID)
		cardID, created, _, err := a.syncMirrorCard(entry, lookup)
		if err != nil {
			return summary, fmt.Errorf("sync card for %q: %w", e.RelPath, err)
		}
		cardIDByRelPath[e.RelPath] = cardID
		if created {
			summary.addCreated(e.IsDir)
		}
	}
	return summary, nil
}

// acceptedEntriesByDepth filters scanned down to req.AcceptedRelPaths
// and orders them shallowest-first, so containment resolution
// (resolveImportParent) always finds a container's own card already
// assigned by the time one of its children is processed.
func acceptedEntriesByDepth(scanned []FolderScanEntry, acceptedRelPaths []string) []FolderScanEntry {
	accepted := make(map[string]bool, len(acceptedRelPaths))
	for _, rp := range acceptedRelPaths {
		accepted[rp] = true
	}
	ordered := make([]FolderScanEntry, 0, len(scanned))
	for _, e := range scanned {
		if accepted[e.RelPath] {
			ordered = append(ordered, e)
		}
	}
	sort.SliceStable(ordered, func(i, j int) bool {
		return strings.Count(ordered[i].RelPath, "/") < strings.Count(ordered[j].RelPath, "/")
	})
	return ordered
}

// cardIsCanvas reports whether id names a live card currently rendering
// in canvas mode -- "" (TargetParentID's own "true root" value) is
// never canvas.
func (a *AtlasService) cardIsCanvas(id string) bool {
	for _, c := range a.Cards() {
		if c.ID == id {
			return c.EffectiveViewMode() == atlas.ViewModeCanvas
		}
	}
	return false
}

// kindsByIDIndex resolves every declared Kind once, keyed by ID, so
// each accepted entry can coerce its own file's frontmatter against
// its chosen category's real field set (goal 0172's "the Kind is the
// contract", extended from the ledger-sync path to this generic import
// path).
func (a *AtlasService) kindsByIDIndex() map[string]atlas.Kind {
	kindsByID := make(map[string]atlas.Kind)
	for _, k := range a.Kinds() {
		kindsByID[k.ID] = k
	}
	return kindsByID
}

// resolveImportParent resolves e's own containing card id: its scanned
// parent's already-assigned card id when that parent was itself
// accepted (acceptedEntriesByDepth's ordering guarantees it was already
// synced), or targetParentID when the parent wasn't accepted -- an
// accepted entry is never dropped just because its own container
// wasn't kept. atTarget reports whether the result IS targetParentID;
// only entries landing directly there get grid-positioned.
func resolveImportParent(e FolderScanEntry, targetParentID string, cardIDByRelPath map[string]string) (parentCardID string, atTarget bool) {
	parentCardID = targetParentID
	if e.ParentRelPath != "" {
		if id, ok := cardIDByRelPath[e.ParentRelPath]; ok {
			parentCardID = id
		}
	}
	return parentCardID, parentCardID == targetParentID
}

// scopedMirrorLookup restricts byMirror to the one existing candidate
// (if any) at mirrorPath whose OWN ParentID already equals
// parentCardID -- goal 0088's cross-space duplicate-import behavior
// (matching content imported into a DIFFERENT space still creates its
// own independent card there) must survive goal 0178's reimport-
// merges-in-place behavior, for a container entry exactly as much as a
// file one (S2 extends the same identity mechanism to both); the two
// are reconciled by scoping "is this the same card" to "already lives
// in the same container", never the whole atlas. An empty mirrorPath
// never matches anything, same as byMirror itself -- defensive only,
// since every entry buildImportMirrorEntry produces now carries one.
func scopedMirrorLookup(byMirror map[string]atlas.Card, mirrorPath, parentCardID string) map[string]atlas.Card {
	if mirrorPath == "" {
		return nil
	}
	existing, ok := byMirror[mirrorPath]
	if !ok || existing.ParentID != parentCardID {
		return nil
	}
	return map[string]atlas.Card{mirrorPath: existing}
}

// buildImportMirrorEntry packages one accepted scan entry as a
// mirrorSyncEntry ready for syncMirrorCard. A directory entry (goal
// 0178 S2) gets its own absolute path as MirrorPath -- the container
// identity that makes nested reimport idempotent -- but no Checksum
// (a directory has no content hash) and no Fields (it has no
// frontmatter to coerce). A file entry's checksum/frontmatter are read
// here (goal 0088), not looked up from the preceding preview scan --
// ImportFolderSuggestions re-scans root itself, so the path is
// guaranteed readable at the same moment it's hashed.
func buildImportMirrorEntry(root string, e FolderScanEntry, kindID, parentCardID string, position *atlas.Position, kindsByID map[string]atlas.Kind) mirrorSyncEntry {
	viewMode := atlas.ViewMode("")
	mirrorPath := filepath.Join(root, filepath.FromSlash(e.RelPath))
	var checksum string
	var fields map[string]string
	if e.IsDir {
		viewMode = atlas.ViewModeShelves
	} else {
		if sum, csErr := fileChecksum(mirrorPath); csErr == nil {
			checksum = sum
		}
		if raw, ok := readFileFrontmatter(mirrorPath); ok {
			fields = atlas.CoerceFrontmatterFields(raw, kindsByID[kindID].Fields)
		}
	}
	return mirrorSyncEntry{
		MirrorPath: mirrorPath, Checksum: checksum,
		NewCardID: seeding.NewSlugID(e.SuggestedTitle, "card"),
		KindID:    kindID, Title: e.SuggestedTitle, ParentID: parentCardID,
		Position: position, ViewMode: viewMode, Fields: fields,
	}
}

// addCreated tallies one freshly-created entry into the right counter
// -- never called for a merely reused/refreshed reimport (goal 0178
// S1's own idempotency point).
func (s *FolderImportSummary) addCreated(isDir bool) {
	if isDir {
		s.ContainersCreated++
	} else {
		s.CardsCreated++
	}
}

// importGridPosition places the nth root-level imported card in a
// simple left-to-right, wrapping grid -- spacing matches the
// frontend board's own note-card footprint (atlasBoardLayout.ts's
// NOTE_WIDTH/NOTE_HEIGHT/BOARD_GAP) so a freshly imported batch never
// overlaps itself. Not collision-checked against pre-existing
// siblings (createCard's own findFreeDropPosition is the single-card,
// frontend-side version of that) -- a bulk import landing near other
// cards is expected to be dragged into place afterward, same as any
// other multi-card layout. startY clears the seeded root space's own
// typical content (a region frame at the canvas origin) rather than
// starting the grid directly on top of it.
func importGridPosition(index int) *atlas.Position {
	const (
		cardWidth  = 190
		cardHeight = 128
		gap        = 24
		columns    = 4
		startX     = 80
		startY     = 260
	)
	col := index % columns
	row := index / columns
	return &atlas.Position{
		X: float64(startX + col*(cardWidth+gap)),
		Y: float64(startY + row*(cardHeight+gap)),
	}
}
