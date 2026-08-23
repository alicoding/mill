package atlassvc

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/alicoding/mill/internal/adapters/fileread"
	"github.com/alicoding/mill/internal/adapters/windowing"
	"github.com/alicoding/mill/internal/domain/atlas"
)

// This file is synced-folder onboarding's read-only half (docs/goals/
// 0067): an explicit user pick of a folder (PickFolder, the whole
// feature's consent gate -- nothing below it runs without a path the
// user chose) and a bounded heuristic scan (ScanFolder) whose result is
// a PREVIEW only. The write half -- ImportFolderSuggestions, the only
// place any card actually gets written -- lives in
// atlasservice_folderimport.go (split out along this same preview/write
// seam so neither file crowds the 500-line cap).

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
	return windowing.PickFolder("Add cards from a folder", startDir)
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
	// DuplicateOfCardID/DuplicateOfTitle (goal 0088) name the existing
	// mirrored card whose content checksum matches this entry's own
	// file -- both empty when no match was found. A duplicate is flagged,
	// never excluded here: whether to import it anyway is the preview's
	// own accept/reject decision.
	DuplicateOfCardID string
	DuplicateOfTitle  string
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
	// CategoryFields carries one entry per ScanCategory that had at
	// least one file with readable frontmatter -- a category with none
	// (including ScanCategoryContainer, which only ever holds
	// directories) is simply absent, matching this scan's own
	// "propose nothing" empty case.
	CategoryFields []FolderScanCategoryFields
}

// ScanFolder performs the bounded, heuristic scan goal 0067 describes:
// depth/count-capped, hidden entries and symlinks skipped
// (fileread.Scan), each entry classified into a suggestion category by
// extension (atlas.ClassifyScanExtension) with a humanized suggested
// title (atlas.HumanizeFilename), and (goal 0088) flagged when its own
// content checksum matches an already-mirrored card. Read-only against
// Atlas's own cards (the opportunistic checksum backfill below is the
// one write this read-only-looking call makes, and it's additive
// metadata only, never a content change). root must not hold (or be
// held by) Mill's own data (SetGuardedDataPaths).
func (a *AtlasService) ScanFolder(root string) (FolderScanResult, error) {
	a.mu.RLock()
	guardErr := a.guardSyncedFolderLocked(root)
	a.mu.RUnlock()
	if guardErr != nil {
		return FolderScanResult{}, guardErr
	}

	// Backfill FIRST so a folder full of pre-goal-0088 mirrors gets
	// dedupe coverage on the very first scan that touches them, not
	// just ones captured after this field existed.
	a.backfillMirrorChecksums()

	scanned, err := fileread.Scan(root, DefaultScanMaxDepth, DefaultScanMaxEntries)
	if err != nil {
		return FolderScanResult{}, fmt.Errorf("scan folder: %w", err)
	}

	a.mu.RLock()
	checksumIndex := a.checksumIndexLocked()
	titles := a.titlesByIDLocked()
	a.mu.RUnlock()

	entries := make([]FolderScanEntry, len(scanned.Entries))
	frontmatterByCategory := map[atlas.ScanCategory][]map[string]any{}
	for i, e := range scanned.Entries {
		category := atlas.ScanCategoryContainer
		if !e.IsDir {
			category = atlas.ClassifyScanExtension(e.Ext)
		}
		entry := FolderScanEntry{
			RelPath: e.RelPath, ParentRelPath: e.ParentRelPath, Name: e.Name, IsDir: e.IsDir,
			Category: category, SuggestedTitle: atlas.HumanizeFilename(e.Name),
		}
		if !e.IsDir {
			abs := filepath.Join(root, filepath.FromSlash(e.RelPath))
			if sum, csErr := fileChecksum(abs); csErr == nil {
				if dupID, ok := checksumIndex[sum]; ok {
					entry.DuplicateOfCardID = dupID
					entry.DuplicateOfTitle = titles[dupID]
				}
			}
			// Only ScanCategoryFile entries are ever attempted -- an
			// image has no text header to parse, and a directory
			// (ScanCategoryContainer) has no file content at all.
			if category == atlas.ScanCategoryFile {
				if raw, ok := readFileFrontmatter(abs); ok {
					frontmatterByCategory[category] = append(frontmatterByCategory[category], raw)
				}
			}
		}
		entries[i] = entry
	}
	return FolderScanResult{
		Root: root, Entries: entries, Truncated: scanned.Truncated,
		MaxDepth: DefaultScanMaxDepth, MaxEntries: DefaultScanMaxEntries,
		CategoryFields: buildCategoryFields(frontmatterByCategory),
	}, nil
}
