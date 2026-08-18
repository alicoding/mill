package atlassvc

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/alicoding/mill/internal/domain/atlas"
)

func mustMkdir(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(path, 0o750); err != nil {
		t.Fatalf("MkdirAll(%q): %v", path, err)
	}
}

func mustWriteFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("WriteFile(%q): %v", path, err)
	}
}

// firstKindWithLabel finds a seeded Kind's ID by its own label -- fine
// in a _test.go file (the atlasNoHardcode tripwire excludes tests).
func firstKindWithLabel(t *testing.T, a *AtlasService, label string) string {
	t.Helper()
	for _, k := range a.Kinds() {
		if k.Label == label {
			return k.ID
		}
	}
	t.Fatalf("no seeded kind labeled %q", label)
	return ""
}

func TestSetGuardedDataPaths_ScanFolder_RejectsMillsOwnDataDir(t *testing.T) {
	a := newTestAtlasService(t)
	tmp := t.TempDir()
	settingsPath := filepath.Join(tmp, "mill", "settings.json")
	mustMkdir(t, filepath.Dir(settingsPath))
	mustWriteFile(t, settingsPath, "{}")
	a.SetGuardedDataPaths(settingsPath)

	// Picking the exact data directory is rejected.
	if _, err := a.ScanFolder(filepath.Dir(settingsPath)); err == nil {
		t.Error("ScanFolder() on Mill's own data dir = nil error, want rejection")
	}
	// Picking an ANCESTOR of the data directory is also rejected --
	// syncing that ancestor would sync the data dir too.
	if _, err := a.ScanFolder(tmp); err == nil {
		t.Error("ScanFolder() on an ancestor of Mill's own data dir = nil error, want rejection")
	}
}

func TestSetGuardedDataPaths_ScanFolder_AllowsUnrelatedFolder(t *testing.T) {
	a := newTestAtlasService(t)
	dataDir := t.TempDir()
	a.SetGuardedDataPaths(filepath.Join(dataDir, "settings.json"))

	unrelated := t.TempDir()
	mustWriteFile(t, filepath.Join(unrelated, "notes.md"), "# hi")
	if _, err := a.ScanFolder(unrelated); err != nil {
		t.Errorf("ScanFolder() on an unrelated folder = %v, want no error", err)
	}
}

func TestDetectSyncRoots_OnlyReportsCandidatesThatActuallyExist(t *testing.T) {
	a := newTestAtlasService(t)
	home := t.TempDir()
	t.Setenv("HOME", home)
	// Neither candidate exists yet -- nothing to detect.
	if got := a.DetectSyncRoots(); len(got) != 0 {
		t.Errorf("DetectSyncRoots() = %v, want none (no candidate folder exists)", got)
	}
	mustMkdir(t, filepath.Join(home, "Dropbox"))
	got := a.DetectSyncRoots()
	if len(got) != 1 || got[0] != filepath.Join(home, "Dropbox") {
		t.Errorf("DetectSyncRoots() = %v, want exactly the one Dropbox folder that exists", got)
	}
}

func TestPickFolder_TestEnvBypassesRealDialog(t *testing.T) {
	a := newTestAtlasService(t)
	want := t.TempDir()
	t.Setenv(testFolderPickPathEnv, want)
	got, err := a.PickFolder("")
	if err != nil {
		t.Fatalf("PickFolder: %v", err)
	}
	if got != want {
		t.Errorf("PickFolder() = %q, want the env-injected %q", got, want)
	}
}

// buildFixtureFolder lays out:
//
//	root/
//	  Meeting Notes.md
//	  logo.png
//	  .hidden.txt        (must never appear in a suggestion)
//	  Reports/
//	    Q1 Summary.md
func buildFixtureFolder(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	mustWriteFile(t, filepath.Join(root, "Meeting Notes.md"), "# Meeting notes\n")
	mustWriteFile(t, filepath.Join(root, "logo.png"), "not-a-real-png")
	mustWriteFile(t, filepath.Join(root, ".hidden.txt"), "should never be scanned")
	mustMkdir(t, filepath.Join(root, "Reports"))
	mustWriteFile(t, filepath.Join(root, "Reports", "Q1 Summary.md"), "# Q1\n")
	return root
}

func TestScanFolder_ClassifiesAndHumanizesTitlesAndSkipsHidden(t *testing.T) {
	a := newTestAtlasService(t)
	root := buildFixtureFolder(t)

	result, err := a.ScanFolder(root)
	if err != nil {
		t.Fatalf("ScanFolder: %v", err)
	}
	byName := map[string]FolderScanEntry{}
	for _, e := range result.Entries {
		byName[e.Name] = e
		if e.Name == ".hidden.txt" {
			t.Error("ScanFolder() suggested a hidden file")
		}
	}
	notes, ok := byName["Meeting Notes.md"]
	if !ok {
		t.Fatal("expected Meeting Notes.md among suggestions")
	}
	if notes.Category != atlas.ScanCategoryFile || notes.SuggestedTitle != "Meeting Notes" {
		t.Errorf("Meeting Notes.md entry = %+v, want Category=file SuggestedTitle=%q", notes, "Meeting Notes")
	}
	logo, ok := byName["logo.png"]
	if !ok || logo.Category != atlas.ScanCategoryImage {
		t.Errorf("logo.png entry = %+v (ok=%v), want Category=image", logo, ok)
	}
	reports, ok := byName["Reports"]
	if !ok || !reports.IsDir || reports.Category != atlas.ScanCategoryContainer {
		t.Errorf("Reports entry = %+v (ok=%v), want IsDir=true Category=container", reports, ok)
	}
	summary, ok := byName["Q1 Summary.md"]
	if !ok || summary.ParentRelPath != "Reports" {
		t.Errorf("Q1 Summary.md entry = %+v (ok=%v), want ParentRelPath=Reports", summary, ok)
	}
}

// TestScanFolder_FlagsEntryMatchingAnAlreadyMirroredCardsChecksum
// proves goal 0088's preview-time flag: an entry whose content already
// matches an existing mirrored card names that card, while a
// non-matching entry in the same scan is left unflagged.
func TestScanFolder_FlagsEntryMatchingAnAlreadyMirroredCardsChecksum(t *testing.T) {
	a := newTestAtlasService(t)
	root := buildFixtureFolder(t)

	fileKind := firstKindWithLabel(t, a, "Document")
	existing, err := a.CreateCard(fileKind, "Already here", "", nil, "", nil, "", "",
		filepath.Join(root, "Meeting Notes.md"), "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	a.backfillMirrorChecksums()

	result, err := a.ScanFolder(root)
	if err != nil {
		t.Fatalf("ScanFolder: %v", err)
	}

	var notes, logo FolderScanEntry
	for _, e := range result.Entries {
		switch e.Name {
		case "Meeting Notes.md":
			notes = e
		case "logo.png":
			logo = e
		}
	}
	if notes.DuplicateOfCardID != existing.ID {
		t.Errorf("Meeting Notes.md DuplicateOfCardID = %q, want %q", notes.DuplicateOfCardID, existing.ID)
	}
	if notes.DuplicateOfTitle != "Already here" {
		t.Errorf("Meeting Notes.md DuplicateOfTitle = %q, want %q", notes.DuplicateOfTitle, "Already here")
	}
	if logo.DuplicateOfCardID != "" {
		t.Errorf("logo.png DuplicateOfCardID = %q, want none (distinct content)", logo.DuplicateOfCardID)
	}
}

// Regression: a soft-deleted card's checksum kept flagging its file as
// "already imported", so a delete-then-reimport arrived default-
// unchecked against a card the user could no longer see.
func TestScanFolder_DeletedCardNoLongerFlagsItsFileAsDuplicate(t *testing.T) {
	a := newTestAtlasService(t)
	root := buildFixtureFolder(t)

	fileKind := firstKindWithLabel(t, a, "Document")
	existing, err := a.CreateCard(fileKind, "Already here", "", nil, "", nil, "", "",
		filepath.Join(root, "Meeting Notes.md"), "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	a.backfillMirrorChecksums()
	if _, err := a.DeleteCard(existing.ID); err != nil {
		t.Fatalf("DeleteCard: %v", err)
	}

	result, err := a.ScanFolder(root)
	if err != nil {
		t.Fatalf("ScanFolder: %v", err)
	}
	for _, e := range result.Entries {
		if e.Name == "Meeting Notes.md" && e.DuplicateOfCardID != "" {
			t.Errorf("Meeting Notes.md DuplicateOfCardID = %q, want none after the matching card was deleted", e.DuplicateOfCardID)
		}
	}
}

func TestImportFolderSuggestions_CreatesCardsWithContainmentAndMirrorPath(t *testing.T) {
	a := newTestAtlasService(t)
	root := buildFixtureFolder(t)
	scanned, err := a.ScanFolder(root)
	if err != nil {
		t.Fatalf("ScanFolder: %v", err)
	}

	fileKind := firstKindWithLabel(t, a, "Document")
	imageKind := firstKindWithLabel(t, a, "Document") // v1 groups images under the same user-chosen doc-like kind by default in this test
	containerKind := firstKindWithLabel(t, a, "Topic")

	accepted := make([]string, 0, len(scanned.Entries))
	for _, e := range scanned.Entries {
		accepted = append(accepted, e.RelPath)
	}

	summary, err := a.ImportFolderSuggestions(ImportFolderSuggestionsRequest{
		Root:             root,
		TargetParentID:   "",
		AcceptedRelPaths: accepted,
		CategoryKindIDs: map[string]string{
			string(atlas.ScanCategoryFile):      fileKind,
			string(atlas.ScanCategoryImage):     imageKind,
			string(atlas.ScanCategoryContainer): containerKind,
		},
	})
	if err != nil {
		t.Fatalf("ImportFolderSuggestions: %v", err)
	}
	if summary.CardsCreated != 3 || summary.ContainersCreated != 1 {
		t.Errorf("summary = %+v, want 3 cards + 1 container", summary)
	}

	cards := a.Cards()
	var reportsCard, q1Card, notesCard atlas.Card
	for _, c := range cards {
		switch c.Title {
		case "Reports":
			reportsCard = c
		case "Q1 Summary":
			q1Card = c
		case "Meeting Notes":
			notesCard = c
		}
	}
	if reportsCard.ID == "" || reportsCard.ParentID != "" || reportsCard.EffectiveViewMode() != atlas.ViewModeShelves {
		t.Errorf("Reports container card = %+v, want root-level shelves container", reportsCard)
	}
	if q1Card.ID == "" || q1Card.ParentID != reportsCard.ID {
		t.Errorf("Q1 Summary card ParentID = %q, want %q (nested under its own scanned folder)", q1Card.ParentID, reportsCard.ID)
	}
	if q1Card.MirrorPath != filepath.Join(root, "Reports", "Q1 Summary.md") {
		t.Errorf("Q1 Summary MirrorPath = %q, want the real absolute file path", q1Card.MirrorPath)
	}
	if notesCard.MirrorPath != filepath.Join(root, "Meeting Notes.md") {
		t.Errorf("Meeting Notes MirrorPath = %q, want the real absolute file path", notesCard.MirrorPath)
	}
	wantSum, err := fileChecksum(notesCard.MirrorPath)
	if err != nil {
		t.Fatalf("fileChecksum: %v", err)
	}
	if notesCard.MirrorChecksum != wantSum {
		t.Errorf("Meeting Notes MirrorChecksum = %q, want %q (goal 0088: stored at import time)", notesCard.MirrorChecksum, wantSum)
	}
}

// TestImportFolderSuggestions_GridsRootLevelCardsUnderACanvasTarget is a
// committed regression test (testing.md): a live Playwright run first
// caught two batch-imported root-level cards both landing at a nil
// Position (the canvas's own documented origin default) and
// physically overlapping, making the second card's DOM node
// unclickable underneath the first.
func TestImportFolderSuggestions_GridsRootLevelCardsUnderACanvasTarget(t *testing.T) {
	a := newTestAtlasService(t)
	root := buildFixtureFolder(t)
	containerKind := firstKindWithLabel(t, a, "Topic")
	target, err := a.CreateCard(containerKind, "Canvas target", "", nil, "", nil, atlas.ViewModeCanvas, "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}

	if _, err := a.ImportFolderSuggestions(ImportFolderSuggestionsRequest{
		Root:             root,
		TargetParentID:   target.ID,
		AcceptedRelPaths: []string{"Meeting Notes.md", "logo.png", "Reports", "Reports/Q1 Summary.md"},
		CategoryKindIDs: map[string]string{
			string(atlas.ScanCategoryFile):      containerKind,
			string(atlas.ScanCategoryImage):     containerKind,
			string(atlas.ScanCategoryContainer): containerKind,
		},
	}); err != nil {
		t.Fatalf("ImportFolderSuggestions: %v", err)
	}

	seenPositions := map[atlas.Position]bool{}
	var reportsCard, q1Card atlas.Card
	for _, c := range a.Cards() {
		switch c.Title {
		case "Reports":
			reportsCard = c
		case "Q1 Summary":
			q1Card = c
		}
		if c.ParentID != target.ID {
			continue
		}
		if c.Position == nil {
			t.Errorf("root-level imported card %q has a nil Position under a canvas-mode target", c.Title)
			continue
		}
		if seenPositions[*c.Position] {
			t.Errorf("root-level imported card %q shares its Position with another card in the same batch: %+v", c.Title, *c.Position)
		}
		seenPositions[*c.Position] = true
	}
	// The nested entry lands inside Reports (a freshly-created SHELVES
	// container, per goal 0067), which never reads Position at all.
	if q1Card.ParentID != reportsCard.ID || q1Card.Position != nil {
		t.Errorf("Q1 Summary card = %+v, want nested under Reports with no Position", q1Card)
	}
}

func TestImportFolderSuggestions_PartialAcceptOnlyCreatesAcceptedEntries(t *testing.T) {
	a := newTestAtlasService(t)
	root := buildFixtureFolder(t)
	fileKind := firstKindWithLabel(t, a, "Document")

	summary, err := a.ImportFolderSuggestions(ImportFolderSuggestionsRequest{
		Root:             root,
		AcceptedRelPaths: []string{"Meeting Notes.md"},
		CategoryKindIDs:  map[string]string{string(atlas.ScanCategoryFile): fileKind},
	})
	if err != nil {
		t.Fatalf("ImportFolderSuggestions: %v", err)
	}
	if summary.CardsCreated != 1 || summary.ContainersCreated != 0 {
		t.Errorf("summary = %+v, want exactly the one accepted card", summary)
	}
	for _, c := range a.Cards() {
		if c.Title == "Q1 Summary" || c.Title == "Reports" || c.Title == "Logo" {
			t.Errorf("ImportFolderSuggestions created an entry that was never accepted: %q", c.Title)
		}
	}
}

func TestImportFolderSuggestions_MissingCategoryKindErrors(t *testing.T) {
	a := newTestAtlasService(t)
	root := buildFixtureFolder(t)
	if _, err := a.ImportFolderSuggestions(ImportFolderSuggestionsRequest{
		Root:             root,
		AcceptedRelPaths: []string{"Meeting Notes.md"},
		CategoryKindIDs:  map[string]string{}, // no kind chosen for the "file" category
	}); err == nil {
		t.Error("ImportFolderSuggestions() with no target kind chosen = nil error, want an error")
	}
}

func TestImportFolderSuggestions_GuardsMillsOwnDataDir(t *testing.T) {
	a := newTestAtlasService(t)
	tmp := t.TempDir()
	settingsPath := filepath.Join(tmp, "mill", "settings.json")
	mustMkdir(t, filepath.Dir(settingsPath))
	a.SetGuardedDataPaths(settingsPath)

	if _, err := a.ImportFolderSuggestions(ImportFolderSuggestionsRequest{
		Root:             filepath.Dir(settingsPath),
		AcceptedRelPaths: []string{},
	}); err == nil {
		t.Error("ImportFolderSuggestions() on Mill's own data dir = nil error, want rejection")
	}
}
