package atlassvc

import (
	"path/filepath"
	"testing"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/domain/typedfield"
)

// buildNonMillFrontmatterFolder lays out four markdown files whose
// frontmatter uses entirely non-Mill keys (goal 0172's own acceptance
// example: ticket/owner/released), shaped to exercise three of
// InferFrontmatterFields' precedence branches at once: "ticket" is
// unique per file (falls through to text), "owner" repeats across
// exactly two distinct values four times over (options), "released" is
// a native YAML boolean in every file (boolean), and "due" is an
// unquoted YAML date in every file, distinct each time (falls through
// to text -- proving the date-shaped value is never proposed as a date
// field, at this integration layer, not just the pure function's own).
func buildNonMillFrontmatterFolder(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	files := []struct {
		name, ticket, owner, released, due string
	}{
		{"one.md", "TCK-1", "alice", "true", "2026-01-01"},
		{"two.md", "TCK-2", "alice", "false", "2026-01-02"},
		{"three.md", "TCK-3", "bob", "true", "2026-01-03"},
		{"four.md", "TCK-4", "bob", "false", "2026-01-04"},
	}
	for _, f := range files {
		content := "---\nticket: " + f.ticket + "\nowner: " + f.owner +
			"\nreleased: " + f.released + "\ndue: " + f.due + "\n---\nBody text.\n"
		mustWriteFile(t, filepath.Join(root, f.name), content)
	}
	return root
}

func categoryFields(t *testing.T, result FolderScanResult, category atlas.ScanCategory) []typedfield.Field {
	t.Helper()
	for _, cf := range result.CategoryFields {
		if cf.Category == category {
			return cf.Fields
		}
	}
	t.Fatalf("no CategoryFields entry for category %q among %+v", category, result.CategoryFields)
	return nil
}

// TestScanFolder_ProposesFrontmatterFieldsFromNonMillKeys pins goal
// 0172 S2's acceptance: a folder whose frontmatter uses entirely
// non-Mill keys still produces a typed proposal, with no code change
// and no date-typed field.
func TestScanFolder_ProposesFrontmatterFieldsFromNonMillKeys(t *testing.T) {
	a := newTestAtlasService(t)
	root := buildNonMillFrontmatterFolder(t)

	result, err := a.ScanFolder(root)
	if err != nil {
		t.Fatalf("ScanFolder: %v", err)
	}
	fields := categoryFields(t, result, atlas.ScanCategoryFile)

	byKey := map[string]typedfield.Field{}
	for _, f := range fields {
		byKey[f.Key] = f
		if f.Type == typedfield.TypeDate {
			t.Errorf("field %q inferred TypeDate -- never allowed", f.Key)
		}
	}
	if got := byKey["ticket"].Type; got != typedfield.TypeText {
		t.Errorf("ticket Type = %q, want text (four distinct values)", got)
	}
	if got := byKey["owner"].Type; got != typedfield.TypeOptions {
		t.Errorf("owner Type = %q, want options (two values repeating 4x)", got)
	}
	if got := byKey["released"].Type; got != typedfield.TypeBoolean {
		t.Errorf("released Type = %q, want boolean", got)
	}
	if got := byKey["due"].Type; got != typedfield.TypeText {
		t.Errorf("due Type = %q, want text -- a date-shaped value must never become a date field", got)
	}
}

// TestScanFolder_FolderWithNoFrontmatterProposesNoCategoryFields pins
// the design contract's "no fields found" case at the backend layer:
// a category with no readable frontmatter anywhere is simply absent
// from CategoryFields (the frontend renders its own message for that).
func TestScanFolder_FolderWithNoFrontmatterProposesNoCategoryFields(t *testing.T) {
	a := newTestAtlasService(t)
	root := buildFixtureFolder(t)

	result, err := a.ScanFolder(root)
	if err != nil {
		t.Fatalf("ScanFolder: %v", err)
	}
	if len(result.CategoryFields) != 0 {
		t.Errorf("CategoryFields = %+v, want none (no fixture file carries frontmatter)", result.CategoryFields)
	}
}

// TestImportFolderSuggestions_CoercesFrontmatterOntoAFreshlyCreatedKind
// proves goal 0172 S2's whole point end to end: a Kind built from the
// proposal (mirror-owned fields matching the files' own keys, plus an
// unmatched "status" field the files never carry) actually receives
// the files' own values at creation time, while the unmatched field
// is left completely unset -- the same "absent means untouched"
// mechanism S1 proved for the ledger-sync re-sync path, extended here
// to this generic import path's own initial creation.
func TestImportFolderSuggestions_CoercesFrontmatterOntoAFreshlyCreatedKind(t *testing.T) {
	a := newTestAtlasService(t)
	root := buildNonMillFrontmatterFolder(t)

	kind, err := a.CreateKind("Ticket", "", "🎫", []typedfield.Field{
		{Key: "ticket", Label: "Ticket", Type: typedfield.TypeText},
		{Key: "owner", Label: "Owner", Type: typedfield.TypeOptions, Options: []string{"alice", "bob"}},
		{Key: "released", Label: "Released", Type: typedfield.TypeBoolean},
		{Key: "status", Label: "Status", Type: typedfield.TypeOptions, Options: []string{"pending", "approved"}, ShowOnCard: true},
	})
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}

	summary, err := a.ImportFolderSuggestions(ImportFolderSuggestionsRequest{
		Root:             root,
		AcceptedRelPaths: []string{"one.md"},
		CategoryKindIDs:  map[string]string{string(atlas.ScanCategoryFile): kind.ID},
	})
	if err != nil {
		t.Fatalf("ImportFolderSuggestions: %v", err)
	}
	if summary.CardsCreated != 1 {
		t.Fatalf("summary = %+v, want exactly 1 card", summary)
	}

	var card atlas.Card
	for _, c := range a.Cards() {
		if c.KindID == kind.ID {
			card = c
		}
	}
	if card.ID == "" {
		t.Fatal("no card found for the freshly created Kind")
	}
	if card.Fields["ticket"] != "TCK-1" || card.Fields["owner"] != "alice" || card.Fields["released"] != "true" {
		t.Errorf("card.Fields = %+v, want ticket/owner/released coerced from one.md's own frontmatter", card.Fields)
	}
	if _, present := card.Fields["status"]; present {
		t.Errorf("card.Fields[status] is present as %q, want ABSENT -- the files never carry it, so it must stay owner-only", card.Fields["status"])
	}
}
