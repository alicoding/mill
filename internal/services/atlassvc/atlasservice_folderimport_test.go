package atlassvc

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/domain/typedfield"
)

// buildFlatFilesFolder lays out a folder with no subdirectories --
// goal 0178 S1's shared mirror-sync primitive only gives FILE cards a
// MirrorPath identity (deliberately not containers, see
// ImportFolderSuggestions' own doc comment), so these reimport tests
// use a flat layout to isolate what S1 actually fixes.
func buildFlatFilesFolder(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	mustWriteFile(t, filepath.Join(root, "Meeting Notes.md"), "# Meeting notes\n")
	mustWriteFile(t, filepath.Join(root, "logo.png"), "not-a-real-png")
	return root
}

// TestImportFolderSuggestions_ReimportDoesNotDuplicateCards pins goal
// 0178 S1's headline acceptance: importing the same folder a second
// time updates the existing cards instead of creating duplicates. This
// replaces the old, never-actually-committed expectation that a
// re-import "still creates a card" for an already-imported file -- that
// was the bug this goal exists to fix, not a behaviour to keep pinning.
func TestImportFolderSuggestions_ReimportDoesNotDuplicateCards(t *testing.T) {
	a := newTestAtlasService(t)
	root := buildFlatFilesFolder(t)
	fileKind := firstKindWithLabel(t, a, "Document")
	req := ImportFolderSuggestionsRequest{
		Root:             root,
		AcceptedRelPaths: []string{"Meeting Notes.md", "logo.png"},
		CategoryKindIDs: map[string]string{
			string(atlas.ScanCategoryFile):  fileKind,
			string(atlas.ScanCategoryImage): fileKind,
		},
	}

	first, err := a.ImportFolderSuggestions(req)
	if err != nil {
		t.Fatalf("first ImportFolderSuggestions: %v", err)
	}
	if first.CardsCreated != 2 {
		t.Fatalf("first import CardsCreated = %d, want 2", first.CardsCreated)
	}
	baseline := len(a.Cards())

	second, err := a.ImportFolderSuggestions(req)
	if err != nil {
		t.Fatalf("second ImportFolderSuggestions: %v", err)
	}
	if second.CardsCreated != 0 {
		t.Errorf("second import CardsCreated = %d, want 0 (both files already have cards)", second.CardsCreated)
	}
	if got := len(a.Cards()); got != baseline {
		t.Errorf("card count after reimport = %d, want unchanged %d", got, baseline)
	}
}

// TestImportFolderSuggestions_ReimportMergesMirrorOwnedPreservesOwnerOwned
// is goal 0172's owner-owned-field-survives-a-resync promise, finally
// checkable through ImportFolderSuggestions itself rather than only
// the ledger sync: a field the file's frontmatter carries ("ticket")
// picks up a later content change, while a field only ever set by the
// user in the app ("status") survives the same reimport untouched.
func TestImportFolderSuggestions_ReimportMergesMirrorOwnedPreservesOwnerOwned(t *testing.T) {
	a := newTestAtlasService(t)
	root := t.TempDir()
	fixture := filepath.Join(root, "one.md")
	mustWriteFile(t, fixture, "---\nticket: TCK-1\n---\nBody.\n")

	kind, err := a.CreateKind("Ticket", "", "🎫", []typedfield.Field{
		{Key: "ticket", Label: "Ticket", Type: typedfield.TypeText},
		{Key: "status", Label: "Status", Type: typedfield.TypeOptions, Options: []string{"pending", "reviewed"}, ShowOnCard: true},
	})
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	req := ImportFolderSuggestionsRequest{
		Root:             root,
		AcceptedRelPaths: []string{"one.md"},
		CategoryKindIDs:  map[string]string{string(atlas.ScanCategoryFile): kind.ID},
	}

	if _, err := a.ImportFolderSuggestions(req); err != nil {
		t.Fatalf("first ImportFolderSuggestions: %v", err)
	}
	var card atlas.Card
	for _, c := range a.Cards() {
		if c.KindID == kind.ID {
			card = c
		}
	}
	if card.ID == "" {
		t.Fatal("no card found for the freshly imported file")
	}
	if card.Fields["ticket"] != "TCK-1" {
		t.Fatalf("ticket after first import = %q, want %q", card.Fields["ticket"], "TCK-1")
	}

	// A manual, in-app edit -- the same "owner sets a field the file
	// never carries" journey the ledger's own reconcile test drives.
	owned := map[string]string{"ticket": card.Fields["ticket"], "status": "reviewed"}
	if _, err := a.UpdateCard(card.ID, card.Title, card.Note, owned, card.Source, card.MirrorPath, card.RefreshWorkflowID); err != nil {
		t.Fatalf("UpdateCard (set status): %v", err)
	}

	// The source file changes -- a real, later edit.
	mustWriteFile(t, fixture, "---\nticket: TCK-2\n---\nBody.\n")
	baseline := len(a.Cards())

	if _, err := a.ImportFolderSuggestions(req); err != nil {
		t.Fatalf("second ImportFolderSuggestions: %v", err)
	}
	if got := len(a.Cards()); got != baseline {
		t.Errorf("card count after reimport = %d, want unchanged %d (no duplicate)", got, baseline)
	}
	var reSynced atlas.Card
	for _, c := range a.Cards() {
		if c.ID == card.ID {
			reSynced = c
		}
	}
	if reSynced.Fields["ticket"] != "TCK-2" {
		t.Errorf("ticket after reimport = %q, want the new content's %q", reSynced.Fields["ticket"], "TCK-2")
	}
	if reSynced.Fields["status"] != "reviewed" {
		t.Errorf("status after reimport = %q, want the manually-set %q to survive", reSynced.Fields["status"], "reviewed")
	}
}

// TestImportFolderSuggestions_ReimportLeavesVanishedFileCardUntouched
// pins the S1 decision that a source file no longer on disk is never
// deleted: it simply can't be re-accepted (a fresh scan never lists a
// file that's gone), so its existing card is left exactly as it was.
func TestImportFolderSuggestions_ReimportLeavesVanishedFileCardUntouched(t *testing.T) {
	a := newTestAtlasService(t)
	root := buildFlatFilesFolder(t)
	fileKind := firstKindWithLabel(t, a, "Document")

	if _, err := a.ImportFolderSuggestions(ImportFolderSuggestionsRequest{
		Root:             root,
		AcceptedRelPaths: []string{"Meeting Notes.md", "logo.png"},
		CategoryKindIDs: map[string]string{
			string(atlas.ScanCategoryFile):  fileKind,
			string(atlas.ScanCategoryImage): fileKind,
		},
	}); err != nil {
		t.Fatalf("first ImportFolderSuggestions: %v", err)
	}
	var vanished atlas.Card
	for _, c := range a.Cards() {
		if c.Title == "Meeting Notes" {
			vanished = c
		}
	}
	if vanished.ID == "" {
		t.Fatal("no card found for Meeting Notes.md")
	}
	baseline := len(a.Cards())

	if err := os.Remove(filepath.Join(root, "Meeting Notes.md")); err != nil {
		t.Fatalf("remove fixture: %v", err)
	}
	rescanned, err := a.ScanFolder(root)
	if err != nil {
		t.Fatalf("ScanFolder: %v", err)
	}
	accepted := make([]string, 0, len(rescanned.Entries))
	for _, e := range rescanned.Entries {
		accepted = append(accepted, e.RelPath)
	}
	if _, err := a.ImportFolderSuggestions(ImportFolderSuggestionsRequest{
		Root:             root,
		AcceptedRelPaths: accepted,
		CategoryKindIDs: map[string]string{
			string(atlas.ScanCategoryFile):  fileKind,
			string(atlas.ScanCategoryImage): fileKind,
		},
	}); err != nil {
		t.Fatalf("second ImportFolderSuggestions: %v", err)
	}

	if got := len(a.Cards()); got != baseline {
		t.Errorf("card count after reimport of a folder missing one file = %d, want unchanged %d", got, baseline)
	}
	var stillThere atlas.Card
	for _, c := range a.Cards() {
		if c.ID == vanished.ID {
			stillThere = c
		}
	}
	if stillThere.ID != vanished.ID || stillThere.Title != vanished.Title {
		t.Errorf("card for the vanished file = %+v, want it left untouched as %+v", stillThere, vanished)
	}
}
