package atlassvc

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/alicoding/mill/internal/domain/atlas"
)

func TestWriteObjectMirror_WritesBytesAndArmsExistingWatch(t *testing.T) {
	a := newTestAtlasService(t)
	ch := hookChannel(t)
	path := filepath.Join(t.TempDir(), "flow.drawio")
	if err := os.WriteFile(path, []byte("<mxfile></mxfile>"), 0o600); err != nil {
		t.Fatal(err)
	}
	o, err := a.CreateBoardObject("diagram", map[string]string{"mirrorPath": path}, atlas.Position{}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}

	newXML := "<mxfile><diagram id=\"1\"><mxGraphModel/></diagram></mxfile>"
	if err := a.WriteObjectMirror(o.ID, newXML); err != nil {
		t.Fatalf("WriteObjectMirror: %v", err)
	}

	got, err := os.ReadFile(path) // #nosec G304 -- t.TempDir()-rooted fixed path this test itself created
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != newXML {
		t.Errorf("mirror file content = %q, want %q", got, newXML)
	}

	// The write rides the SAME fsnotify watch armed at create time
	// (goal 0237 S1) -- no second signal, just the existing one firing
	// because the bytes on disk actually changed.
	waitForMirrorChange(t, ch, o.ID)
}

func TestWriteObjectMirror_UnknownID_Errors(t *testing.T) {
	a := newTestAtlasService(t)
	if err := a.WriteObjectMirror("does-not-exist", "<mxfile/>"); err == nil {
		t.Fatal("expected an error for an unknown object id")
	}
}

func TestWriteObjectMirror_NoMirrorPath_Errors(t *testing.T) {
	a := newTestAtlasService(t)
	o, err := a.CreateBoardObject("sticky", map[string]string{}, atlas.Position{}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}
	if err := a.WriteObjectMirror(o.ID, "<mxfile/>"); err == nil {
		t.Fatal("expected an error for a board object with no mirrored file")
	}
}

func TestWriteObjectMirror_CsvSheet_Writes(t *testing.T) {
	a := newTestAtlasService(t)
	path := filepath.Join(t.TempDir(), "budget.csv")
	if err := os.WriteFile(path, []byte("a,b\n1,2\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	o, err := a.CreateBoardObject("sheet", map[string]string{"mirrorPath": path}, atlas.Position{}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}
	edited := "a,b\n1,3\n"
	if err := a.WriteObjectMirror(o.ID, edited); err != nil {
		t.Fatalf("WriteObjectMirror over csv: %v", err)
	}
	got, err := os.ReadFile(path) // #nosec G304 -- t.TempDir()-rooted fixed path this test itself created
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != edited {
		t.Errorf("csv content = %q, want %q", got, edited)
	}
}

// A text write over a binary workbook is corruption by construction --
// the quick-edit slice's own data-stewardship refusal (goal 0239 S2).
func TestWriteObjectMirror_BinarySheetExtension_Refuses(t *testing.T) {
	a := newTestAtlasService(t)
	path := filepath.Join(t.TempDir(), "budget.xlsx")
	if err := os.WriteFile(path, []byte{0x50, 0x4b, 0x03, 0x04}, 0o600); err != nil {
		t.Fatal(err)
	}
	o, err := a.CreateBoardObject("sheet", map[string]string{"mirrorPath": path}, atlas.Position{}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}
	if err := a.WriteObjectMirror(o.ID, "a,b\n1,2\n"); err == nil {
		t.Fatal("expected a refusal writing text over a binary spreadsheet")
	}
	got, err := os.ReadFile(path) // #nosec G304 -- t.TempDir()-rooted fixed path this test itself created
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "PK\x03\x04" {
		t.Errorf("xlsx bytes were touched by a refused write: %q", got)
	}
}

func TestWriteObjectMirror_NonDiagramExtension_Errors(t *testing.T) {
	a := newTestAtlasService(t)
	path := filepath.Join(t.TempDir(), "notes.md")
	if err := os.WriteFile(path, []byte("# Title"), 0o600); err != nil {
		t.Fatal(err)
	}
	o, err := a.CreateBoardObject("diagram", map[string]string{"mirrorPath": path}, atlas.Position{}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}
	if err := a.WriteObjectMirror(o.ID, "<mxfile/>"); err == nil {
		t.Fatal("expected an error writing drawio XML over a non-diagram mirror extension")
	}
}
