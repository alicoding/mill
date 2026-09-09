package xlsx

import (
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/xuri/excelize/v2"
)

// testdata/sample.xlsx (goal 0365 S1): two sheets, a bold merged
// title, a formula column and plain values -- the surface every
// round-trip test below proves survives an edit untouched.
const fixturePath = "testdata/sample.xlsx"

// scanBound covers every cell testdata/sample.xlsx actually uses,
// with slack for a test's own new cells -- wide enough that a
// snapshot comparison over it is equivalent to a whole-file compare.
const scanCols, scanRows = 8, 8

// copyFixture copies testdata/sample.xlsx into a scratch file so a
// test can edit it without mutating the committed fixture.
func copyFixture(t *testing.T) string {
	t.Helper()
	src, err := os.Open(fixturePath) // #nosec G304 -- fixturePath is this package's own fixed constant, never input
	if err != nil {
		t.Fatalf("open fixture: %v", err)
	}
	defer func() { _ = src.Close() }()

	dst := filepath.Join(t.TempDir(), "sample.xlsx")
	out, err := os.Create(dst) // #nosec G304 -- dst is this test's own tempdir-scoped path, never input
	if err != nil {
		t.Fatalf("create scratch copy: %v", err)
	}
	defer func() { _ = out.Close() }()
	if _, err := io.Copy(out, src); err != nil {
		t.Fatalf("copy fixture: %v", err)
	}
	return dst
}

// cellSnapshot is one cell's whole observable state -- everything an
// edit to a DIFFERENT cell must never change.
type cellSnapshot struct {
	value   string
	formula string
	styleID int
}

// workbookSnapshot captures every sheet's cells (over scanCols x
// scanRows) and merged ranges, keyed by sheet name -- a full-fidelity
// baseline to diff against after an edit.
type workbookSnapshot struct {
	sheets []string
	cells  map[string]map[string]cellSnapshot
	merges map[string][]excelize.MergeCell
}

func snapshotWorkbook(t *testing.T, path string) workbookSnapshot {
	t.Helper()
	f, err := excelize.OpenFile(path)
	if err != nil {
		t.Fatalf("open %s: %v", path, err)
	}
	defer func() { _ = f.Close() }()

	snap := workbookSnapshot{
		sheets: f.GetSheetList(),
		cells:  map[string]map[string]cellSnapshot{},
		merges: map[string][]excelize.MergeCell{},
	}
	for _, sheetName := range snap.sheets {
		cells := map[string]cellSnapshot{}
		for row := 1; row <= scanRows; row++ {
			for col := 1; col <= scanCols; col++ {
				cell, err := excelize.CoordinatesToCellName(col, row)
				if err != nil {
					t.Fatalf("CoordinatesToCellName: %v", err)
				}
				value, err := f.GetCellValue(sheetName, cell)
				if err != nil {
					t.Fatalf("GetCellValue(%s,%s): %v", sheetName, cell, err)
				}
				formula, err := f.GetCellFormula(sheetName, cell)
				if err != nil {
					t.Fatalf("GetCellFormula(%s,%s): %v", sheetName, cell, err)
				}
				styleID, err := f.GetCellStyle(sheetName, cell)
				if err != nil {
					t.Fatalf("GetCellStyle(%s,%s): %v", sheetName, cell, err)
				}
				cells[cell] = cellSnapshot{value: value, formula: formula, styleID: styleID}
			}
		}
		snap.cells[sheetName] = cells
		merges, err := f.GetMergeCells(sheetName)
		if err != nil {
			t.Fatalf("GetMergeCells(%s): %v", sheetName, err)
		}
		snap.merges[sheetName] = merges
	}
	return snap
}

// TestEditCells_ChangesOnlyNamedCells is the round-trip proof the
// design contract requires: every cell NOT named in the edit, every
// style id, every other sheet and every formula survives, byte for
// byte in observable terms, comparing the saved file back against
// excelize's own reader.
func TestEditCells_ChangesOnlyNamedCells(t *testing.T) {
	path := copyFixture(t)
	before := snapshotWorkbook(t, path)

	newValue := "4"
	newFormula := "=SUM(B3:B4)"
	edits := []CellEdit{
		{Address: "B3", Value: &newValue},
		{Address: "E1", Formula: &newFormula},
	}
	if err := EditCells(path, "Sheet1", edits); err != nil {
		t.Fatalf("EditCells: %v", err)
	}

	after := snapshotWorkbook(t, path)

	if !reflect.DeepEqual(before.sheets, after.sheets) {
		t.Errorf("sheet list changed: before=%v after=%v", before.sheets, after.sheets)
	}

	edited := map[string]map[string]bool{
		"Sheet1": {"B3": true, "E1": true},
	}
	for _, sheetName := range before.sheets {
		for cell, want := range before.cells[sheetName] {
			if edited[sheetName][cell] {
				continue
			}
			got := after.cells[sheetName][cell]
			if got != want {
				t.Errorf("%s!%s changed by an edit elsewhere: before=%+v after=%+v", sheetName, cell, want, got)
			}
		}
		if !reflect.DeepEqual(before.merges[sheetName], after.merges[sheetName]) {
			t.Errorf("%s merged ranges changed: before=%v after=%v", sheetName, before.merges[sheetName], after.merges[sheetName])
		}
	}

	if got := after.cells["Sheet1"]["B3"].value; got != "4" {
		t.Errorf("B3 value = %q, want 4", got)
	}
	if got := after.cells["Sheet1"]["E1"].formula; got != "SUM(B3:B4)" {
		t.Errorf("E1 formula = %q, want SUM(B3:B4)", got)
	}
}

func TestEditCells_BadAddressFailsWholeCallBeforeWriting(t *testing.T) {
	path := copyFixture(t)
	before := snapshotWorkbook(t, path)

	v := "x"
	if err := EditCells(path, "Sheet1", []CellEdit{{Address: "B3", Value: &v}, {Address: "nope", Value: &v}}); err == nil {
		t.Fatal("want an error for the unparseable address")
	}

	after := snapshotWorkbook(t, path)
	if !reflect.DeepEqual(before, after) {
		t.Error("a rejected multi-edit call still wrote to the file")
	}
}

func TestEditCells_RequiresExactlyOneOfValueOrFormula(t *testing.T) {
	path := copyFixture(t)
	if err := EditCells(path, "Sheet1", []CellEdit{{Address: "B3"}}); err == nil {
		t.Fatal("want an error when neither value nor formula is set")
	}
	v, f := "x", "SUM(B3:B4)"
	if err := EditCells(path, "Sheet1", []CellEdit{{Address: "B3", Value: &v, Formula: &f}}); err == nil {
		t.Fatal("want an error when both value and formula are set")
	}
}

func TestReadRange_DefaultsToFirstSheetAndWholeUsedRange(t *testing.T) {
	got, err := ReadRange(fixturePath, "", "")
	if err != nil {
		t.Fatalf("ReadRange: %v", err)
	}
	if got.Sheet != "Sheet1" {
		t.Errorf("Sheet = %q, want Sheet1 (the workbook's first)", got.Sheet)
	}
	if got.Dimensions.Rows == 0 || got.Dimensions.Cols == 0 {
		t.Errorf("Dimensions = %+v, want a non-empty used range", got.Dimensions)
	}
}

func TestReadRange_ReturnsFormulaTextInAParallelGrid(t *testing.T) {
	got, err := ReadRange(fixturePath, "Sheet1", "C3:C4")
	if err != nil {
		t.Fatalf("ReadRange: %v", err)
	}
	want := [][]string{{"B3*10"}, {"B4*10"}}
	if !reflect.DeepEqual(got.Formulas, want) {
		t.Errorf("Formulas = %v, want %v", got.Formulas, want)
	}
}

func TestReadRange_UnknownSheetNamesSheetsPresent(t *testing.T) {
	_, err := ReadRange(fixturePath, "DoesNotExist", "")
	if err == nil {
		t.Fatal("want an error for an unknown sheet")
	}
	msg := err.Error()
	if !strings.Contains(msg, "Sheet1") || !strings.Contains(msg, "Notes") {
		t.Errorf("error %q does not name the sheets present", msg)
	}
}
