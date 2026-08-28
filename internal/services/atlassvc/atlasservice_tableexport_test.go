package atlassvc

import (
	"bytes"
	"encoding/base64"
	"encoding/csv"
	"strings"
	"testing"

	"github.com/xuri/excelize/v2"
)

func wireExportProjection(a *AtlasService) {
	a.WireListProjection(func(listID string) (ListProjection, bool) {
		if listID != "list-inventory" {
			return ListProjection{}, false
		}
		return ListProjection{
			ListID: "list-inventory", Label: "Q3 Inventory",
			Columns: []ProjectionColumn{
				{Key: "item", Label: "Item Name", Type: "text"},
				{Key: "qty", Label: "Quantity", Type: "number"},
				{Key: "inStock", Label: "In Stock", Type: "boolean"},
				{Key: "restockedOn", Label: "Restocked On", Type: "date"},
			},
			Rows: []ProjectionRow{
				{ID: "row-1", Status: "active", Values: map[string]string{
					"item": "Widgets | Deluxe", "qty": "42.5", "inStock": "true", "restockedOn": "2026-08-01",
				}},
				{ID: "row-2", Status: "active", Values: map[string]string{
					"item": "Multi\nline note", "qty": "", "inStock": "false", "restockedOn": "",
				}},
			},
		}, true
	})
}

func TestSerializeDelimited_CSV_HeadersAreLabelsAndValuesRoundTrip(t *testing.T) {
	columns := []ProjectionColumn{{Key: "item", Label: "Item Name"}, {Key: "qty", Label: "Quantity"}}
	rows := []ProjectionRow{
		{Values: map[string]string{"item": "Acme, Inc.", "qty": "3"}},
		{Values: map[string]string{"item": "Quoted \"Widget\"", "qty": ""}},
	}

	data, err := serializeDelimited(columns, rows, ',')
	if err != nil {
		t.Fatalf("serializeDelimited: %v", err)
	}

	records, err := csv.NewReader(strings.NewReader(string(data))).ReadAll()
	if err != nil {
		t.Fatalf("read back csv: %v", err)
	}
	want := [][]string{
		{"Item Name", "Quantity"},
		{"Acme, Inc.", "3"},
		{"Quoted \"Widget\"", ""},
	}
	if len(records) != len(want) {
		t.Fatalf("records = %d rows, want %d", len(records), len(want))
	}
	for i := range want {
		if records[i][0] != want[i][0] || records[i][1] != want[i][1] {
			t.Errorf("row %d = %v, want %v", i, records[i], want[i])
		}
	}
}

func TestSerializeDelimited_TSV_UsesTabAndRoundTrips(t *testing.T) {
	columns := []ProjectionColumn{{Key: "a", Label: "A"}, {Key: "b", Label: "B"}}
	rows := []ProjectionRow{{Values: map[string]string{"a": "one", "b": "two"}}}

	data, err := serializeDelimited(columns, rows, '\t')
	if err != nil {
		t.Fatalf("serializeDelimited: %v", err)
	}
	if !strings.Contains(string(data), "A\tB\n") {
		t.Fatalf("tsv header = %q, want tab-separated A\\tB", string(data))
	}

	r := csv.NewReader(strings.NewReader(string(data)))
	r.Comma = '\t'
	records, err := r.ReadAll()
	if err != nil {
		t.Fatalf("read back tsv: %v", err)
	}
	if len(records) != 2 || records[1][0] != "one" || records[1][1] != "two" {
		t.Fatalf("records = %v, want the roundtripped row", records)
	}
}

func TestSerializeMarkdownTable_EscapesPipesAndCollapsesNewlines(t *testing.T) {
	columns := []ProjectionColumn{{Key: "item", Label: "Item"}, {Key: "note", Label: "Note"}}
	rows := []ProjectionRow{
		{Values: map[string]string{"item": "A | B", "note": "line one\nline two"}},
	}

	out := string(serializeMarkdownTable(columns, rows))
	lines := strings.Split(strings.TrimRight(out, "\n"), "\n")
	if len(lines) != 3 {
		t.Fatalf("markdown table has %d lines, want header+separator+1 row: %q", len(lines), out)
	}
	if lines[0] != "| Item | Note |" {
		t.Errorf("header = %q", lines[0])
	}
	if lines[1] != "| --- | --- |" {
		t.Errorf("separator = %q", lines[1])
	}
	if lines[2] != "| A \\| B | line one line two |" {
		t.Errorf("data row = %q, want the pipe escaped and the newline collapsed to a space", lines[2])
	}
}

func TestSerializeXLSX_RealTypedCellsReadBack(t *testing.T) {
	columns := []ProjectionColumn{
		{Key: "item", Label: "Item Name", Type: "text"},
		{Key: "qty", Label: "Quantity", Type: "number"},
		{Key: "inStock", Label: "In Stock", Type: "boolean"},
		{Key: "restockedOn", Label: "Restocked On", Type: "date"},
	}
	rows := []ProjectionRow{
		{Values: map[string]string{"item": "Widgets", "qty": "42.5", "inStock": "true", "restockedOn": "2026-08-01"}},
		{Values: map[string]string{"item": "Empties", "qty": "", "inStock": "false", "restockedOn": ""}},
	}

	data, err := serializeXLSX(columns, rows)
	if err != nil {
		t.Fatalf("serializeXLSX: %v", err)
	}

	rf, err := excelize.OpenReader(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("open produced workbook: %v", err)
	}
	defer func() { _ = rf.Close() }()
	sheet := rf.GetSheetName(0)

	headerRow, err := rf.GetRows(sheet)
	if err != nil {
		t.Fatalf("GetRows: %v", err)
	}
	wantHeader := []string{"Item Name", "Quantity", "In Stock", "Restocked On"}
	for i, h := range wantHeader {
		if headerRow[0][i] != h {
			t.Errorf("header[%d] = %q, want %q", i, headerRow[0][i], h)
		}
	}

	// Row 1 (sheet row 2): real typed number/bool cells, a plain string
	// date cell (setTypedCell's documented v1 scope). A native OOXML
	// number carries no "t" attribute at all (excelize's cellTypes map
	// only recognizes explicit b/d/n/e/s/str/inlineStr markers), so
	// GetCellType reports it as CellTypeUnset -- the proof it is a real
	// number cell is that value, contrasted against the text column
	// (item, below), which DOES carry an explicit shared-string marker.
	itemType, err := rf.GetCellType(sheet, "A2")
	if err != nil {
		t.Fatalf("GetCellType(A2): %v", err)
	}
	if itemType != excelize.CellTypeSharedString {
		t.Errorf("item cell type = %v, want CellTypeSharedString (a real text cell)", itemType)
	}
	qtyType, err := rf.GetCellType(sheet, "B2")
	if err != nil {
		t.Fatalf("GetCellType(B2): %v", err)
	}
	if qtyType != excelize.CellTypeUnset {
		t.Errorf("qty cell type = %v, want CellTypeUnset (excelize's native-number marker)", qtyType)
	}
	if v, _ := rf.GetCellValue(sheet, "B2"); v != "42.5" {
		t.Errorf("qty value = %q, want 42.5", v)
	}
	boolType, err := rf.GetCellType(sheet, "C2")
	if err != nil {
		t.Fatalf("GetCellType(C2): %v", err)
	}
	if boolType != excelize.CellTypeBool {
		t.Errorf("inStock cell type = %v, want CellTypeBool", boolType)
	}
	if v, _ := rf.GetCellValue(sheet, "C2"); v != "TRUE" {
		t.Errorf("inStock value = %q, want TRUE", v)
	}
	dateType, err := rf.GetCellType(sheet, "D2")
	if err != nil {
		t.Fatalf("GetCellType(D2): %v", err)
	}
	if dateType != excelize.CellTypeSharedString {
		t.Errorf("date cell type = %v, want CellTypeSharedString (a plain text cell, not a native Excel date)", dateType)
	}
	if v, _ := rf.GetCellValue(sheet, "D2"); v != "2026-08-01" {
		t.Errorf("date cell = %q, want the plain stored string 2026-08-01", v)
	}

	// Row 2: every empty stored value stays a genuinely empty cell, not
	// "0"/"FALSE"/"" written out.
	if v, _ := rf.GetCellValue(sheet, "B3"); v != "" {
		t.Errorf("empty qty = %q, want empty cell", v)
	}
	boolType2, _ := rf.GetCellType(sheet, "C3")
	if v, _ := rf.GetCellValue(sheet, "C3"); v != "FALSE" || boolType2 != excelize.CellTypeBool {
		t.Errorf("inStock row2 = %q/%v, want typed FALSE", v, boolType2)
	}
}

func TestSerializeTableProjection_UnrecognizedFormatErrors(t *testing.T) {
	if _, _, err := serializeTableProjection(nil, nil, "pdf"); err == nil {
		t.Fatal("unrecognized format must error, not silently produce something")
	}
}

func TestTableProjectionExport_EndToEnd_AllFourFormats(t *testing.T) {
	a := newTestAtlasService(t)
	wireExportProjection(a)
	kind := firstKindWithLabel(t, a, "Document")

	card := makeProjectionCard(t, a, kind, "Inventory", "list-inventory")

	for format, wantExt := range map[string]string{"csv": ".csv", "tsv": ".tsv", "markdown": ".md", "xlsx": ".xlsx"} {
		result, err := a.TableProjectionExport(card.ID, format)
		if err != nil {
			t.Fatalf("TableProjectionExport(%q): %v", format, err)
		}
		if result.Filename != "Q3-Inventory"+wantExt {
			t.Errorf("format %q filename = %q, want Q3-Inventory%s", format, result.Filename, wantExt)
		}
		raw, err := base64.StdEncoding.DecodeString(result.Data)
		if err != nil {
			t.Fatalf("format %q: Data is not valid base64: %v", format, err)
		}
		if len(raw) == 0 {
			t.Errorf("format %q produced zero bytes", format)
		}
		if format == "csv" && !strings.Contains(string(raw), "Item Name") {
			t.Errorf("csv bytes = %q, want the header present", string(raw))
		}
	}

	if _, err := a.TableProjectionExport(card.ID, "vsdx"); err == nil {
		t.Fatal("an unrecognized format must fail, not silently succeed")
	}

	plain, err := a.CreateCard(kind, "Plain", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	if _, err := a.TableProjectionExport(plain.ID, "csv"); err == nil {
		t.Fatal("a non-projection card must refuse export, not return empty bytes")
	}
}
