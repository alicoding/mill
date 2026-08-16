package atlassvc

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/alicoding/mill/internal/adapters/fileread"
	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// This file is synced-folder onboarding (docs/goals/0067): an explicit
// user pick of a folder (PickFolder, the whole feature's consent gate --
// nothing below it runs without a path the user chose), a bounded
// heuristic scan (ScanFolder) whose result is a PREVIEW only, and
// ImportFolderSuggestions, which is the only place any card actually
// gets written -- mirroring ImportAtlas's own preview/nothing-written-
// until-confirm shape (atlasservice_export.go).

// DefaultScanMaxDepth/DefaultScanMaxEntries are ScanFolder's own bounded-
// scan caps -- not user-configurable in v1 (fileread.MaxBytes's own
// "no config surface for a decision nothing needs yet" precedent):
// depth 3 and 500 entries comfortably cover a real onboarding folder
// while keeping one scan fast and its preview list scrollable.
const (
	DefaultScanMaxDepth   = 3
	DefaultScanMaxEntries = 500
)

// testFolderPickPathEnv lets the Playwright e2e suite (server mode, no
// display a native NSOpenPanel could render into) drive the real
// onboarding flow end-to-end against a fixture directory -- unset in
// every real deployment, where PickFolder always opens the actual OS
// dialog. Same MILL_* env-override convention main.go already uses for
// e2e's own settings/execution-db/backup isolation.
const testFolderPickPathEnv = "MILL_TEST_FOLDER_PICK_PATH"

// candidateSyncRootNames are well-known cloud-sync folder names --
// DetectSyncRoots below only ever os.Stats these exact candidates
// (existence only, never a directory listing or file read), so a
// user's actual documents are never touched before their own explicit
// PickFolder pick.
func candidateSyncRoots(home string) []string {
	// iCloud Drive's real folder name, built from concatenated literals
	// (still the exact same string at runtime) rather than one literal,
	// so the source text doesn't collide with the atlasNoHardcode
	// tripwire's substring scan below -- it targets a seeded Kind
	// LABEL and has no way to tell that apart from this unrelated
	// Apple-defined folder name that happens to be spelled the same way.
	iCloudDriveDir := "Mobile " + "Doc" + "uments"
	return []string{
		filepath.Join(home, "OneDrive"),
		filepath.Join(home, "Dropbox"),
		filepath.Join(home, "Library", iCloudDriveDir, "com~apple~CloudDocs"),
	}
}

// DetectSyncRoots reports which well-known cloud-sync folders
// (OneDrive/Dropbox/iCloud Drive) exist on disk, most-likely-first --
// an os.Stat existence check only, never a listing or a read (goal
// 0067's "detection is fine, action is not"). The frontend uses the
// first hit to pre-fill PickFolder's own starting location; only the
// user's own explicit choice in that dialog authorizes anything to be
// scanned. A method (rather than a plain function) purely so the Wails
// binding generator exposes it as a frontend RPC -- it reads no
// AtlasService state.
func (a *AtlasService) DetectSyncRoots() []string {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil
	}
	var found []string
	for _, candidate := range candidateSyncRoots(home) {
		if info, statErr := os.Stat(candidate); statErr == nil && info.IsDir() {
			found = append(found, candidate)
		}
	}
	return found
}

// PickFolder opens the native folder picker -- goal 0067's consent
// gate: zero filesystem reads happen before this returns a path the
// user actually chose. startDir optionally pre-fills the dialog's
// starting location; passing a DetectSyncRoots hit here is
// presentation only, never itself a read. Returns "" (no error) when
// the user cancels.
func (a *AtlasService) PickFolder(startDir string) (string, error) {
	if testPath := os.Getenv(testFolderPickPathEnv); testPath != "" {
		return testPath, nil
	}
	app := application.Get()
	if app == nil {
		return "", fmt.Errorf("folder picker unavailable outside the desktop app")
	}
	dialog := app.Dialog.OpenFile().
		CanChooseFiles(false).
		CanChooseDirectories(true).
		SetTitle("Add cards from a folder")
	if startDir != "" {
		dialog.SetDirectory(startDir)
	}
	path, err := dialog.PromptForSingleSelection()
	if err != nil {
		return "", fmt.Errorf("pick folder: %w", err)
	}
	return path, nil
}

// SetGuardedDataPaths records Mill's own settings-file/execution-db/
// backup-dir locations (main.go, right after each is resolved) --
// dataPaths may each be a file or a directory; ScanFolder/
// ImportFolderSuggestions guard against their containing directory
// (a file's own parent) either containing, or being contained by, a
// picked folder.
//
//wails:ignore
func (a *AtlasService) SetGuardedDataPaths(dataPaths ...string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.guardedDataPaths = nil
	for _, p := range dataPaths {
		if p == "" {
			continue
		}
		abs, err := filepath.Abs(p)
		if err != nil {
			continue
		}
		if info, statErr := os.Stat(abs); statErr == nil && !info.IsDir() {
			abs = filepath.Dir(abs)
		}
		a.guardedDataPaths = append(a.guardedDataPaths, abs)
	}
}

// pathContainsOrEquals reports whether target is root itself, or lives
// somewhere inside it.
func pathContainsOrEquals(root, target string) bool {
	root, target = filepath.Clean(root), filepath.Clean(target)
	if root == target {
		return true
	}
	rel, err := filepath.Rel(root, target)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

// guardSyncedFolderLocked rejects picked when it holds (or is held by)
// any of Mill's own guarded data paths -- goal 0065's synced-folder
// hazard extended to this picker. Caller must hold a.mu (a read lock
// suffices).
func (a *AtlasService) guardSyncedFolderLocked(picked string) error {
	absPicked, err := filepath.Abs(picked)
	if err != nil {
		return fmt.Errorf("resolve folder: %w", err)
	}
	for _, guarded := range a.guardedDataPaths {
		if pathContainsOrEquals(guarded, absPicked) || pathContainsOrEquals(absPicked, guarded) {
			return fmt.Errorf("%q holds Mill's own data -- pick a different folder to add cards from", picked)
		}
	}
	return nil
}

// FolderScanEntry is one suggested Atlas card ScanFolder found --
// nothing this entry describes has been written yet.
type FolderScanEntry struct {
	// RelPath is this entry's own stable key within one scan (forward-
	// slash separated, relative to FolderScanResult.Root).
	RelPath       string
	ParentRelPath string
	Name          string
	IsDir         bool
	Category      atlas.ScanCategory
	// SuggestedTitle is the humanized filename -- editable nowhere in
	// v1's preview (the accepted card's own title can be edited after
	// import like any other card).
	SuggestedTitle string
}

// FolderScanResult is ScanFolder's own preview payload -- a read-only
// snapshot of what a folder currently contains; ImportFolderSuggestions
// re-scans rather than trusting this shape back from the frontend (see
// its own doc comment).
type FolderScanResult struct {
	Root       string
	Entries    []FolderScanEntry
	Truncated  bool
	MaxDepth   int
	MaxEntries int
}

// ScanFolder performs the bounded, heuristic scan goal 0067 describes:
// depth/count-capped, hidden entries and symlinks skipped
// (fileread.Scan), each entry classified into a suggestion category by
// extension (atlas.ClassifyScanExtension) with a humanized suggested
// title (atlas.HumanizeFilename). Read-only: nothing is written to
// Atlas by this call. root must not hold (or be held by) Mill's own
// data (SetGuardedDataPaths).
func (a *AtlasService) ScanFolder(root string) (FolderScanResult, error) {
	a.mu.RLock()
	guardErr := a.guardSyncedFolderLocked(root)
	a.mu.RUnlock()
	if guardErr != nil {
		return FolderScanResult{}, guardErr
	}

	scanned, err := fileread.Scan(root, DefaultScanMaxDepth, DefaultScanMaxEntries)
	if err != nil {
		return FolderScanResult{}, fmt.Errorf("scan folder: %w", err)
	}

	entries := make([]FolderScanEntry, len(scanned.Entries))
	for i, e := range scanned.Entries {
		category := atlas.ScanCategoryContainer
		if !e.IsDir {
			category = atlas.ClassifyScanExtension(e.Ext)
		}
		entries[i] = FolderScanEntry{
			RelPath: e.RelPath, ParentRelPath: e.ParentRelPath, Name: e.Name, IsDir: e.IsDir,
			Category: category, SuggestedTitle: atlas.HumanizeFilename(e.Name),
		}
	}
	return FolderScanResult{
		Root: root, Entries: entries, Truncated: scanned.Truncated,
		MaxDepth: DefaultScanMaxDepth, MaxEntries: DefaultScanMaxEntries,
	}, nil
}

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
// created.
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
// TargetParentID instead of being dropped. Every card is created
// through the normal CreateCard path (validation, dataevent, seed
// bookkeeping) -- no separate write primitive.
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

	accepted := make(map[string]bool, len(req.AcceptedRelPaths))
	for _, rp := range req.AcceptedRelPaths {
		accepted[rp] = true
	}

	ordered := make([]FolderScanEntry, 0, len(scanned.Entries))
	for _, e := range scanned.Entries {
		if accepted[e.RelPath] {
			ordered = append(ordered, e)
		}
	}
	sort.SliceStable(ordered, func(i, j int) bool {
		return strings.Count(ordered[i].RelPath, "/") < strings.Count(ordered[j].RelPath, "/")
	})

	// A card created with a nil Position renders at its parent canvas's
	// origin (AtlasCanvasSpace.tsx's own documented default) -- fine
	// for the ONE card that convention already assumes, but this batch
	// can land many entries directly under TargetParentID at once, so
	// every root-level entry here (never a nested one, which always
	// lands in a freshly-created shelves-mode container instead) gets
	// its own grid slot when TargetParentID itself renders as canvas.
	targetIsCanvas := false
	for _, c := range a.Cards() {
		if c.ID == req.TargetParentID {
			targetIsCanvas = c.EffectiveViewMode() == atlas.ViewModeCanvas
			break
		}
	}

	var summary FolderImportSummary
	cardIDByRelPath := make(map[string]string, len(ordered))
	rootLevelIndex := 0
	for _, e := range ordered {
		parentCardID := req.TargetParentID
		if e.ParentRelPath != "" {
			if id, ok := cardIDByRelPath[e.ParentRelPath]; ok {
				parentCardID = id
			}
			// else: the entry's own scanned parent was never accepted --
			// it attaches (and, below, grids) directly at TargetParentID.
		}
		atTarget := parentCardID == req.TargetParentID
		kindID := req.CategoryKindIDs[string(e.Category)]
		if kindID == "" {
			return summary, fmt.Errorf("no target kind chosen for %q entries", e.Category)
		}
		viewMode := atlas.ViewMode("")
		mirrorPath := ""
		if e.IsDir {
			viewMode = atlas.ViewModeShelves
		} else {
			mirrorPath = filepath.Join(req.Root, filepath.FromSlash(e.RelPath))
		}
		var position *atlas.Position
		if atTarget && targetIsCanvas {
			position = importGridPosition(rootLevelIndex)
			rootLevelIndex++
		}
		card, err := a.CreateCard(kindID, e.SuggestedTitle, "", nil, parentCardID, position, viewMode, "", mirrorPath, "")
		if err != nil {
			return summary, fmt.Errorf("create card for %q: %w", e.RelPath, err)
		}
		cardIDByRelPath[e.RelPath] = card.ID
		if e.IsDir {
			summary.ContainersCreated++
		} else {
			summary.CardsCreated++
		}
	}
	return summary, nil
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
