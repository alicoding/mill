package atlassvc

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/alicoding/mill/internal/domain/atlas"
)

func TestCreateCardFromFileDrop_ResolvesKindByExtension(t *testing.T) {
	a := newTestAtlasService(t)

	prose, err := a.CreateCardFromFileDrop("/tmp/notes.md", "notes", "", nil)
	if err != nil {
		t.Fatalf("CreateCardFromFileDrop(prose): %v", err)
	}
	if prose.KindID != fileDropProseKindID {
		t.Errorf("prose file KindID = %q, want %q", prose.KindID, fileDropProseKindID)
	}
	if prose.MirrorPath != "/tmp/notes.md" {
		t.Errorf("MirrorPath = %q, want the dropped path (mirror-only)", prose.MirrorPath)
	}
	if prose.Title != "notes" {
		t.Errorf("Title = %q, want the caller-supplied title", prose.Title)
	}

	other, err := a.CreateCardFromFileDrop("/tmp/archive.zip", "archive", "", nil)
	if err != nil {
		t.Fatalf("CreateCardFromFileDrop(other): %v", err)
	}
	if other.KindID != fileDropReferenceKindID {
		t.Errorf("non-prose file KindID = %q, want %q", other.KindID, fileDropReferenceKindID)
	}
}

func TestCreateCardFromFileDrop_ParentAndPosition(t *testing.T) {
	a := newTestAtlasService(t)
	parent := leafCard(t, a.Cards())
	// leafCard may itself be a leaf under a parent -- use its own
	// ParentID's sibling space instead so this card can legitimately
	// contain the dropped file.
	pos := &atlas.Position{X: 12, Y: 34}
	card, err := a.CreateCardFromFileDrop("/tmp/notes.md", "notes", parent.ParentID, pos)
	if err != nil {
		t.Fatalf("CreateCardFromFileDrop: %v", err)
	}
	if card.ParentID != parent.ParentID {
		t.Errorf("ParentID = %q, want %q", card.ParentID, parent.ParentID)
	}
	if card.Position == nil || card.Position.X != 12 || card.Position.Y != 34 {
		t.Errorf("Position = %+v, want {12 34}", card.Position)
	}
}

// TestCreateCardFromFileDrop_KindDeleted_FallsBackGracefully proves a
// dropped file is never refused just because its seeded destination
// Kind has been deleted or renamed -- it lands under whichever Kind IS
// declared instead of erroring.
func TestCreateCardFromFileDrop_KindDeleted_FallsBackGracefully(t *testing.T) {
	a := newTestAtlasService(t)
	a.mu.Lock()
	kept := a.kinds[0]
	a.kinds = []atlas.Kind{kept}
	a.mu.Unlock()

	card, err := a.CreateCardFromFileDrop("/tmp/notes.md", "notes", "", nil)
	if err != nil {
		t.Fatalf("CreateCardFromFileDrop with the seeded Kind gone: %v", err)
	}
	if card.KindID != kept.ID {
		t.Errorf("KindID = %q, want the one remaining Kind %q", card.KindID, kept.ID)
	}
}

func TestCreateLinkedFileCard_CreatesSiblingAndLink(t *testing.T) {
	a := newTestAtlasService(t)
	open := leafCard(t, a.Cards())
	beforeLinks := len(a.Links())

	card, err := a.CreateLinkedFileCard(open.ID, "/tmp/notes.md", "notes", nil)
	if err != nil {
		t.Fatalf("CreateLinkedFileCard: %v", err)
	}
	if card.ParentID != open.ParentID {
		t.Errorf("linked sibling ParentID = %q, want the open card's own ParentID %q", card.ParentID, open.ParentID)
	}

	links := a.Links()
	if len(links) != beforeLinks+1 {
		t.Fatalf("Links() count = %d, want %d (exactly one new link)", len(links), beforeLinks+1)
	}
	found := false
	for _, l := range links {
		if l.FromCardID == open.ID && l.ToCardID == card.ID {
			found = true
		}
	}
	if !found {
		t.Error("no link from the open card to the new file card")
	}

	// The open card itself is never mutated by this door.
	for _, c := range a.Cards() {
		if c.ID != open.ID {
			continue
		}
		if c.Title != open.Title || c.ParentID != open.ParentID || c.KindID != open.KindID || !c.UpdatedAt.Equal(open.UpdatedAt) {
			t.Errorf("open card was mutated: got %+v, want %+v", c, open)
		}
	}
}

func TestCreateLinkedFileCard_UnknownOpenCard_Errors(t *testing.T) {
	a := newTestAtlasService(t)
	if _, err := a.CreateLinkedFileCard("does-not-exist", "/tmp/notes.md", "notes", nil); err == nil {
		t.Error("expected an error for an unknown open card id")
	}
}

func TestResolveFileDropRoute(t *testing.T) {
	a := newTestAtlasService(t)

	dir := t.TempDir()
	filePath := filepath.Join(dir, "a.md")
	if err := os.WriteFile(filePath, []byte("hi"), 0o600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	subdir := filepath.Join(dir, "sub")
	if err := os.Mkdir(subdir, 0o700); err != nil {
		t.Fatalf("Mkdir: %v", err)
	}

	route, err := a.ResolveFileDropRoute([]string{filePath})
	if err != nil {
		t.Fatalf("ResolveFileDropRoute(single file): %v", err)
	}
	if route.Kind != "instant" || route.Path != filePath {
		t.Errorf("single file route = %+v, want {instant %q}", route, filePath)
	}

	route, err = a.ResolveFileDropRoute([]string{subdir})
	if err != nil {
		t.Fatalf("ResolveFileDropRoute(single directory): %v", err)
	}
	if route.Kind != "import" || route.Path != subdir {
		t.Errorf("single directory route = %+v, want {import %q}", route, subdir)
	}

	filePath2 := filepath.Join(dir, "b.md")
	if err := os.WriteFile(filePath2, []byte("hi"), 0o600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	route, err = a.ResolveFileDropRoute([]string{filePath, filePath2})
	if err != nil {
		t.Fatalf("ResolveFileDropRoute(multiple files): %v", err)
	}
	if route.Kind != "import" || route.Path != dir {
		t.Errorf("multi-file route = %+v, want {import %q} (common ancestor)", route, dir)
	}

	if _, err := a.ResolveFileDropRoute(nil); err == nil {
		t.Error("expected an error for an empty path list")
	}
	if _, err := a.ResolveFileDropRoute([]string{filepath.Join(dir, "nope.md")}); err == nil {
		t.Error("expected an error for a path that does not exist")
	}
}

func TestConvertHTMLToMarkdown(t *testing.T) {
	a := newTestAtlasService(t)
	md, err := a.ConvertHTMLToMarkdown("<h1>Title</h1><p>Body text</p>")
	if err != nil {
		t.Fatalf("ConvertHTMLToMarkdown: %v", err)
	}
	if md == "" {
		t.Error("ConvertHTMLToMarkdown returned empty output for non-empty HTML")
	}
}
