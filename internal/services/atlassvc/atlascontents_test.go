package atlassvc

import (
	"testing"

	"github.com/alicoding/mill/internal/domain/atlas"
)

// One index over cards, notes, and objects: every live entry, titled
// by the display-name rule, stably ordered, narrowable by kind and
// parent. Notes list here and nowhere else before this goal.
func TestContents_ListsCardsNotesAndObjectsWithDisplayNames(t *testing.T) {
	svc := newTestAtlasService(t)
	kindID := svc.Kinds()[0].ID
	root, err := svc.CreateCard(kindID, "Root card", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CreateNote("# Plan\nbody", atlas.Position{X: 1, Y: 2}, root.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CreateNote("", atlas.Position{}, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CreateBoardObject("shape", map[string]string{"shapeType": "rectangle"}, atlas.Position{X: 3, Y: 4}, root.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CreateBoardObject("image", map[string]string{"mirrorPath": "/tmp/x.png", "title": "Reference"}, atlas.Position{}, ""); err != nil {
		t.Fatal(err)
	}

	all := svc.Contents(ContentsFilter{})
	byTitle := map[string]ContentEntry{}
	for _, e := range all {
		byTitle[e.Kind+"/"+e.Title] = e
	}
	if e, ok := byTitle["card/Root card"]; !ok || e.Subkind != kindID {
		t.Errorf("root card missing or without its Kind as subkind: %+v", e)
	}
	if e, ok := byTitle["note/Plan"]; !ok || e.ParentID != root.ID || e.Payload["text"] != "# Plan\nbody" || e.Position.X != 1 {
		t.Errorf("filed note listed wrong: %+v", e)
	}
	if _, ok := byTitle["note/Untitled note"]; !ok {
		t.Error("empty note not listed as Untitled note")
	}
	if e, ok := byTitle["shape/shape"]; !ok || e.Payload["shapeType"] != "rectangle" {
		t.Errorf("shape (titled by kind) listed wrong: %+v", e)
	}
	if e, ok := byTitle["image/Reference"]; !ok || e.ParentID != "" {
		t.Errorf("image (titled by payload) listed wrong: %+v", e)
	}
	for i := 1; i < len(all); i++ {
		a, b := all[i-1], all[i]
		if a.Kind > b.Kind || (a.Kind == b.Kind && a.Title > b.Title) {
			t.Errorf("unsorted at %d: %s/%s before %s/%s", i, a.Kind, a.Title, b.Kind, b.Title)
		}
	}

	notesUnderRoot := svc.ListContents(ContentKindNote, root.ID)
	if len(notesUnderRoot) != 1 || notesUnderRoot[0].Title != "Plan" {
		t.Errorf("ListContents(note, root) = %+v, want exactly the filed note", notesUnderRoot)
	}
	if got := svc.ListContents("nothing-of-this-kind", ""); got == nil || len(got) != 0 {
		t.Errorf("unknown kind must list empty, never nil: %v", got)
	}
}
