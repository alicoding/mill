package atlassvc

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/domain/typedfield"
)

// buildNestedFolder lays out one subfolder holding one file -- the
// shape goal 0178 S1 left non-idempotent (a directory entry carried no
// MirrorPath, so it was recreated fresh on every reimport, and
// everything nested below it resolved to a new parent every time too).
func buildNestedFolder(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	mustMkdir(t, filepath.Join(root, "Reports"))
	mustWriteFile(t, filepath.Join(root, "Reports", "Q1 Summary.md"), "# Q1\nNumbers looked good.\n")
	return root
}

func nestedImportRequest(root, topicKind, docKind string) ImportFolderSuggestionsRequest {
	return ImportFolderSuggestionsRequest{
		Root:             root,
		AcceptedRelPaths: []string{"Reports", "Reports/Q1 Summary.md"},
		CategoryKindIDs: map[string]string{
			string(atlas.ScanCategoryContainer): topicKind,
			string(atlas.ScanCategoryFile):      docKind,
		},
	}
}

// TestImportFolderSuggestions_NestedReimportIsIdempotent pins goal 0178
// S2's headline fix: S1 only made a FLAT reimport idempotent, because a
// directory entry carried no MirrorPath identity, so re-importing a
// NESTED folder into the same target duplicated everything below its
// first container on every run. Giving a container a MirrorPath too
// (buildImportMirrorEntry) makes the same container card get reused on
// the second pass, so its own child resolves to the SAME parent and
// merges in place instead of duplicating.
func TestImportFolderSuggestions_NestedReimportIsIdempotent(t *testing.T) {
	a := newTestAtlasService(t)
	root := buildNestedFolder(t)
	topicKind := firstKindWithLabel(t, a, "Topic")
	docKind := firstKindWithLabel(t, a, "Document")
	req := nestedImportRequest(root, topicKind, docKind)

	first, err := a.ImportFolderSuggestions(req)
	if err != nil {
		t.Fatalf("first ImportFolderSuggestions: %v", err)
	}
	if first.ContainersCreated != 1 || first.CardsCreated != 1 {
		t.Fatalf("first import = %+v, want 1 container + 1 card", first)
	}
	var reportsID, summaryID string
	for _, c := range a.Cards() {
		switch c.Title {
		case "Reports":
			reportsID = c.ID
		case "Q1 Summary":
			summaryID = c.ID
		}
	}
	if reportsID == "" || summaryID == "" {
		t.Fatal("expected both Reports and Q1 Summary cards after the first import")
	}
	baseline := len(a.Cards())

	second, err := a.ImportFolderSuggestions(req)
	if err != nil {
		t.Fatalf("second ImportFolderSuggestions: %v", err)
	}
	if second.ContainersCreated != 0 || second.CardsCreated != 0 {
		t.Errorf("second import = %+v, want nothing created (idempotent)", second)
	}
	if got := len(a.Cards()); got != baseline {
		t.Errorf("card count after nested reimport = %d, want unchanged %d", got, baseline)
	}
	for _, c := range a.Cards() {
		if c.Title == "Reports" && c.ID != reportsID {
			t.Errorf("Reports got a new id on reimport: %s (was %s)", c.ID, reportsID)
		}
		if c.Title == "Q1 Summary" && c.ID != summaryID {
			t.Errorf("Q1 Summary got a new id on reimport: %s (was %s)", c.ID, summaryID)
		}
	}
}

// TestRefreshMirrorContainer_ReSyncsContentAndPreservesOwnerOwnedField
// is goal 0172's owner-owned-field promise, checked through the actual
// "Refresh from folder" product action rather than a raw reimport call:
// a field the file's frontmatter carries picks up a later edit, a field
// only ever set by the user in the app survives it, and the container
// itself ends up synced (LastSyncedAt stamped) even though it has no
// content checksum of its own.
func TestRefreshMirrorContainer_ReSyncsContentAndPreservesOwnerOwnedField(t *testing.T) {
	a := newTestAtlasService(t)
	root := t.TempDir()
	mustMkdir(t, filepath.Join(root, "Reports"))
	fixture := filepath.Join(root, "Reports", "one.md")
	mustWriteFile(t, fixture, "---\nticket: TCK-1\n---\nBody.\n")

	topicKind := firstKindWithLabel(t, a, "Topic")
	ticketKind, err := a.CreateKind("Ticket", "", "🎫", []typedfield.Field{
		{Key: "ticket", Label: "Ticket", Type: typedfield.TypeText},
		{Key: "status", Label: "Status", Type: typedfield.TypeOptions, Options: []string{"pending", "reviewed"}, ShowOnCard: true},
	})
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}

	req := ImportFolderSuggestionsRequest{
		Root:             root,
		AcceptedRelPaths: []string{"Reports", "Reports/one.md"},
		CategoryKindIDs: map[string]string{
			string(atlas.ScanCategoryContainer): topicKind,
			string(atlas.ScanCategoryFile):      ticketKind.ID,
		},
	}
	if _, err := a.ImportFolderSuggestions(req); err != nil {
		t.Fatalf("import: %v", err)
	}
	var container, ticket atlas.Card
	for _, c := range a.Cards() {
		if c.Title == "Reports" {
			container = c
		}
		if c.KindID == ticketKind.ID {
			ticket = c
		}
	}
	if container.ID == "" || ticket.ID == "" {
		t.Fatal("expected both the Reports container and the ticket card after import")
	}

	owned := map[string]string{"ticket": ticket.Fields["ticket"], "status": "reviewed"}
	if _, err := a.UpdateCard(ticket.ID, ticket.Title, ticket.Note, owned, ticket.Source, ticket.MirrorPath, ticket.RefreshWorkflowID); err != nil {
		t.Fatalf("UpdateCard (set status): %v", err)
	}
	mustWriteFile(t, fixture, "---\nticket: TCK-2\n---\nBody.\n")

	if _, err := a.RefreshMirrorContainer(container.ID); err != nil {
		t.Fatalf("RefreshMirrorContainer: %v", err)
	}

	var reContainer, reTicket atlas.Card
	for _, c := range a.Cards() {
		if c.ID == container.ID {
			reContainer = c
		}
		if c.ID == ticket.ID {
			reTicket = c
		}
	}
	if reTicket.Fields["ticket"] != "TCK-2" {
		t.Errorf("ticket after refresh = %q, want the new content's %q", reTicket.Fields["ticket"], "TCK-2")
	}
	if reTicket.Fields["status"] != "reviewed" {
		t.Errorf("status after refresh = %q, want the manually-set %q to survive", reTicket.Fields["status"], "reviewed")
	}
	if reContainer.LastSyncedAt.IsZero() {
		t.Error("container LastSyncedAt still zero after RefreshMirrorContainer")
	}
	if reContainer.MirrorMissing {
		t.Error("container marked MirrorMissing after a refresh that found its folder")
	}
}

// TestRefreshMirrorContainer_MarksVanishedNestedFileMissing_NeverDeletes
// pins the S2 half of goal 0178's own "never delete a vanished source"
// rule (S1 already pinned it for a plain reimport): a file removed from
// disk between imports keeps its card, marked rather than dropped, once
// discovered via the "Refresh from folder" action.
func TestRefreshMirrorContainer_MarksVanishedNestedFileMissing_NeverDeletes(t *testing.T) {
	a := newTestAtlasService(t)
	root := buildNestedFolder(t)
	topicKind := firstKindWithLabel(t, a, "Topic")
	docKind := firstKindWithLabel(t, a, "Document")
	req := nestedImportRequest(root, topicKind, docKind)
	if _, err := a.ImportFolderSuggestions(req); err != nil {
		t.Fatalf("import: %v", err)
	}
	var containerID, fileID string
	for _, c := range a.Cards() {
		if c.Title == "Reports" {
			containerID = c.ID
		}
		if c.Title == "Q1 Summary" {
			fileID = c.ID
		}
	}
	baseline := len(a.Cards())

	if err := os.Remove(filepath.Join(root, "Reports", "Q1 Summary.md")); err != nil {
		t.Fatalf("remove fixture: %v", err)
	}
	if _, err := a.RefreshMirrorContainer(containerID); err != nil {
		t.Fatalf("RefreshMirrorContainer: %v", err)
	}
	if got := len(a.Cards()); got != baseline {
		t.Errorf("card count after refresh with a vanished file = %d, want unchanged %d", got, baseline)
	}
	var vanished atlas.Card
	for _, c := range a.Cards() {
		if c.ID == fileID {
			vanished = c
		}
	}
	if vanished.ID != fileID {
		t.Fatal("the vanished file's card is gone -- it must be marked, never deleted")
	}
	if !vanished.MirrorMissing {
		t.Error("vanished file's card is not marked MirrorMissing after refresh")
	}

	// Restore the identical file (same content, so syncMirrorCard's own
	// checksum-match shortcut would otherwise never revisit it) and
	// refresh again -- the reconciliation pass must clear the mark.
	mustWriteFile(t, filepath.Join(root, "Reports", "Q1 Summary.md"), "# Q1\nNumbers looked good.\n")
	if _, err := a.RefreshMirrorContainer(containerID); err != nil {
		t.Fatalf("RefreshMirrorContainer (restore): %v", err)
	}
	var restored atlas.Card
	for _, c := range a.Cards() {
		if c.ID == fileID {
			restored = c
		}
	}
	if restored.MirrorMissing {
		t.Error("restored file's card is still marked MirrorMissing after its source reappeared")
	}
}

// TestRefreshMirrorContainer_RootFolderVanished_MarksContainerMissingAndErrors
// covers the whole source folder disappearing, not just one file inside
// it: RefreshMirrorContainer can't rescan a folder that no longer
// exists, so it reports the failure AND marks the container itself,
// rather than either silently succeeding or deleting anything.
func TestRefreshMirrorContainer_RootFolderVanished_MarksContainerMissingAndErrors(t *testing.T) {
	a := newTestAtlasService(t)
	root := buildNestedFolder(t)
	topicKind := firstKindWithLabel(t, a, "Topic")
	docKind := firstKindWithLabel(t, a, "Document")
	req := nestedImportRequest(root, topicKind, docKind)
	if _, err := a.ImportFolderSuggestions(req); err != nil {
		t.Fatalf("import: %v", err)
	}
	var containerID string
	for _, c := range a.Cards() {
		if c.Title == "Reports" {
			containerID = c.ID
		}
	}
	baseline := len(a.Cards())

	if err := os.RemoveAll(filepath.Join(root, "Reports")); err != nil {
		t.Fatalf("remove fixture folder: %v", err)
	}
	if _, err := a.RefreshMirrorContainer(containerID); err == nil {
		t.Error("RefreshMirrorContainer with a vanished root folder returned no error")
	}
	if got := len(a.Cards()); got != baseline {
		t.Errorf("card count after a vanished root folder's refresh = %d, want unchanged %d", got, baseline)
	}
	var container atlas.Card
	for _, c := range a.Cards() {
		if c.ID == containerID {
			container = c
		}
	}
	if !container.MirrorMissing {
		t.Error("container not marked MirrorMissing after its own source folder vanished")
	}
}

func TestRefreshMirrorContainer_UnknownCard_Errors(t *testing.T) {
	a := newTestAtlasService(t)
	if _, err := a.RefreshMirrorContainer("nope"); err == nil {
		t.Error("RefreshMirrorContainer with an unknown card id returned no error")
	}
}

func TestRefreshMirrorContainer_NoMirrorPath_Errors(t *testing.T) {
	a := newTestAtlasService(t)
	topicKind := firstKindWithLabel(t, a, "Topic")
	card, err := a.CreateCard(topicKind, "Plain container", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	if _, err := a.RefreshMirrorContainer(card.ID); err == nil {
		t.Error("RefreshMirrorContainer on a card with no MirrorPath returned no error")
	}
}
