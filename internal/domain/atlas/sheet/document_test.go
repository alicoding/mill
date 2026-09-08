package sheet

import "testing"

const sampleCSV = "Item,Qty,Notes\nBeans,2,\nRice,5,bulk\n"

func mustParse(t *testing.T, text string) *Document {
	t.Helper()
	d, err := ParseDocument(text)
	if err != nil {
		t.Fatalf("ParseDocument: %v", err)
	}
	return d
}

func TestParseDocument_EmptyText(t *testing.T) {
	d := mustParse(t, "")
	if dims := d.Dimensions(); dims != (Dimensions{}) {
		t.Errorf("dimensions of empty text = %+v, want zero", dims)
	}
}

func TestDocument_DimensionsAndUsedRange(t *testing.T) {
	d := mustParse(t, sampleCSV)
	if dims := d.Dimensions(); dims != (Dimensions{Rows: 3, Cols: 3}) {
		t.Errorf("dimensions = %+v", dims)
	}
	if got := d.UsedRange().String(); got != "A1:C3" {
		t.Errorf("UsedRange = %q, want A1:C3", got)
	}
}

func TestDocument_ReadRangeWholeAndSub(t *testing.T) {
	d := mustParse(t, sampleCSV)
	rng, err := d.ResolveRange("")
	if err != nil {
		t.Fatalf("ResolveRange(\"\"): %v", err)
	}
	whole := d.ReadRange(rng)
	want := [][]string{{"Item", "Qty", "Notes"}, {"Beans", "2", ""}, {"Rice", "5", "bulk"}}
	if !equalGrid(whole, want) {
		t.Errorf("whole read = %v, want %v", whole, want)
	}

	sub, err := d.ResolveRange("A2:B3")
	if err != nil {
		t.Fatalf("ResolveRange(A2:B3): %v", err)
	}
	got := d.ReadRange(sub)
	wantSub := [][]string{{"Beans", "2"}, {"Rice", "5"}}
	if !equalGrid(got, wantSub) {
		t.Errorf("sub read = %v, want %v", got, wantSub)
	}
}

// A cell past the sheet's own written extent reads as an empty
// string, never an error -- the same forgiving-past-the-edge rule a
// spreadsheet applies.
func TestDocument_ReadRangePastExtentReadsEmpty(t *testing.T) {
	d := mustParse(t, "A,B\n")
	rng, err := ParseRange("A1:C3")
	if err != nil {
		t.Fatalf("ParseRange: %v", err)
	}
	got := d.ReadRange(rng)
	want := [][]string{{"A", "B", ""}, {"", "", ""}, {"", "", ""}}
	if !equalGrid(got, want) {
		t.Errorf("past-extent read = %v, want %v", got, want)
	}
}

func TestDocument_EditCellsChangesOnlyNamedCells(t *testing.T) {
	d := mustParse(t, sampleCSV)
	updated, err := d.EditCells([]CellEdit{{Address: "B2", Value: "3"}})
	if err != nil {
		t.Fatalf("EditCells: %v", err)
	}
	if updated != 1 {
		t.Errorf("updated = %d, want 1", updated)
	}
	out, err := d.Marshal()
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	reparsed := mustParse(t, out)
	rng, _ := reparsed.ResolveRange("")
	got := reparsed.ReadRange(rng)
	want := [][]string{{"Item", "Qty", "Notes"}, {"Beans", "3", ""}, {"Rice", "5", "bulk"}}
	if !equalGrid(got, want) {
		t.Errorf("after edit = %v, want %v (only B2 should have changed)", got, want)
	}
}

// A short row (or a row past the sheet's own current end) pads with
// empty fields only as far as the edited column -- the spreadsheet
// convention: typing past a row's end creates the cells between. The
// source has 2+ columns, so the padded blank row in between re-parses
// as a real row rather than tripping encoding/csv's own blank-line
// rule (TestDocument_SingleColumnBlankRowIsACSVLimitation covers that
// narrower, format-inherent case).
func TestDocument_EditCellsPadsShortAndNewRows(t *testing.T) {
	d := mustParse(t, "A,B\n")
	if _, err := d.EditCells([]CellEdit{{Address: "C1", Value: "x"}, {Address: "A3", Value: "y"}}); err != nil {
		t.Fatalf("EditCells: %v", err)
	}
	out, err := d.Marshal()
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	reparsed := mustParse(t, out)
	rng, _ := reparsed.ResolveRange("")
	got := reparsed.ReadRange(rng)
	want := [][]string{{"A", "B", "x"}, {"", "", ""}, {"y", "", ""}}
	if !equalGrid(got, want) {
		t.Errorf("after pad edit = %v, want %v", got, want)
	}
}

// encoding/csv's Reader treats a record of exactly one empty field as
// a blank line and drops it on the next parse (its own documented
// "blank lines are ignored" rule) -- CSV itself cannot distinguish "an
// all-empty row" from "no row" when there is only one column. A sheet
// with a single column that pads a wholly new blank row this way loses
// that row on the next read; this is a format limitation, not
// something EditCells can paper over for a one-column sheet.
func TestDocument_SingleColumnBlankRowIsACSVLimitation(t *testing.T) {
	d := mustParse(t, "A\n")
	if _, err := d.EditCells([]CellEdit{{Address: "A3", Value: "y"}}); err != nil {
		t.Fatalf("EditCells: %v", err)
	}
	out, err := d.Marshal()
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	reparsed := mustParse(t, out)
	rng, _ := reparsed.ResolveRange("")
	got := reparsed.ReadRange(rng)
	// The intervening blank row (row 2) is gone on re-parse; "y" reads
	// back as row 2, not row 3.
	want := [][]string{{"A"}, {"y"}}
	if !equalGrid(got, want) {
		t.Errorf("single-column pad reread = %v, want %v", got, want)
	}
}

// A bad address in a multi-edit call fails the WHOLE call before
// anything is written -- the same all-or-nothing guarantee the
// diagram tools' own patch calls give.
func TestDocument_EditCellsBadAddressFailsWholeCallBeforeWriting(t *testing.T) {
	d := mustParse(t, sampleCSV)
	before, err := d.Marshal()
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	if _, err := d.EditCells([]CellEdit{{Address: "B2", Value: "new"}, {Address: "nope", Value: "x"}}); err == nil {
		t.Fatal("want an error for the unparseable address")
	}
	after, err := d.Marshal()
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	if before != after {
		t.Errorf("a rejected multi-edit call still wrote B2:\nbefore=%q\nafter=%q", before, after)
	}
}

func TestDocument_MarshalRoundTrip(t *testing.T) {
	d := mustParse(t, sampleCSV)
	out, err := d.Marshal()
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	reparsed := mustParse(t, out)
	if reparsed.Dimensions() != d.Dimensions() {
		t.Errorf("round trip changed dimensions: %+v vs %+v", reparsed.Dimensions(), d.Dimensions())
	}
}

func equalGrid(a, b [][]string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if len(a[i]) != len(b[i]) {
			return false
		}
		for j := range a[i] {
			if a[i][j] != b[i][j] {
				return false
			}
		}
	}
	return true
}
