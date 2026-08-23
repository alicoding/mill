package configuresvc

import (
	"bytes"
	"encoding/base64"
	"slices"
	"testing"

	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
	"github.com/xuri/excelize/v2"
)

func newTestConfigureServiceForXlsx(t *testing.T) *ConfigureService {
	t.Helper()
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	return NewConfigureService(store, comp, servicetest.FakeCredentialStore{})
}

// buildXlsxBase64 writes rows (row 0 = header) to a fresh workbook via
// excelize itself and returns it base64-encoded -- a REAL .xlsx byte
// stream round-tripped through the same library ParseXlsxFile reads
// with, not a hand-built row array, per testing.md's rule that a
// parsing test must exercise real parsing.
func buildXlsxBase64(t *testing.T, sheet string, rows [][]string) string {
	t.Helper()
	f := excelize.NewFile()
	defer func() {
		if err := f.Close(); err != nil {
			t.Fatalf("close workbook: %v", err)
		}
	}()
	if sheet != "Sheet1" {
		idx, err := f.NewSheet(sheet)
		if err != nil {
			t.Fatalf("NewSheet: %v", err)
		}
		f.SetActiveSheet(idx)
		if err := f.DeleteSheet("Sheet1"); err != nil {
			t.Fatalf("DeleteSheet: %v", err)
		}
	}
	for r, row := range rows {
		for c, cell := range row {
			ref, err := excelize.CoordinatesToCellName(c+1, r+1)
			if err != nil {
				t.Fatalf("CoordinatesToCellName: %v", err)
			}
			if err := f.SetCellValue(sheet, ref, cell); err != nil {
				t.Fatalf("SetCellValue(%s): %v", ref, err)
			}
		}
	}
	var buf bytes.Buffer
	if _, err := f.WriteTo(&buf); err != nil {
		t.Fatalf("WriteTo: %v", err)
	}
	return base64.StdEncoding.EncodeToString(buf.Bytes())
}

func TestParseXlsxFile_HeaderAndRows(t *testing.T) {
	cfg := newTestConfigureServiceForXlsx(t)
	b64 := buildXlsxBase64(t, "Sheet1", [][]string{
		{"task", "status"},
		{"write goal", "done"},
		{"ship PR", "open"},
	})

	got, err := cfg.ParseXlsxFile(b64)
	if err != nil {
		t.Fatalf("ParseXlsxFile: %v", err)
	}
	if want := []string{"task", "status"}; !slices.Equal(got.FileColumns, want) {
		t.Errorf("FileColumns = %v, want %v", got.FileColumns, want)
	}
	if len(got.Rows) != 2 {
		t.Fatalf("len(Rows) = %d, want 2", len(got.Rows))
	}
	if got.Rows[0]["task"] != "write goal" || got.Rows[0]["status"] != "done" {
		t.Errorf("Rows[0] = %v", got.Rows[0])
	}
	if got.Rows[1]["task"] != "ship PR" || got.Rows[1]["status"] != "open" {
		t.Errorf("Rows[1] = %v", got.Rows[1])
	}
}

// A ragged data row (fewer trailing cells than the header, which is
// what excelize.GetRows returns for a sparsely-filled row) reads its
// missing cells as "" -- the same alignment a short CSV row gets
// against a longer header.
func TestParseXlsxFile_RaggedRow_MissingTrailingCellsAreEmpty(t *testing.T) {
	cfg := newTestConfigureServiceForXlsx(t)
	b64 := buildXlsxBase64(t, "Sheet1", [][]string{
		{"a", "b", "c"},
		{"1"}, // only the first cell set; b/c stay blank
	})

	got, err := cfg.ParseXlsxFile(b64)
	if err != nil {
		t.Fatalf("ParseXlsxFile: %v", err)
	}
	if len(got.Rows) != 1 {
		t.Fatalf("len(Rows) = %d, want 1", len(got.Rows))
	}
	row := got.Rows[0]
	if row["a"] != "1" || row["b"] != "" || row["c"] != "" {
		t.Errorf("row = %v, want a=1 b= c=", row)
	}
}

// A row with MORE cells than the header has its unlabelled trailing
// cells dropped -- there is no column name for them to land in.
func TestParseXlsxFile_ExtraTrailingCells_Dropped(t *testing.T) {
	cfg := newTestConfigureServiceForXlsx(t)
	b64 := buildXlsxBase64(t, "Sheet1", [][]string{
		{"a"},
		{"1", "extra"},
	})

	got, err := cfg.ParseXlsxFile(b64)
	if err != nil {
		t.Fatalf("ParseXlsxFile: %v", err)
	}
	if len(got.Rows) != 1 {
		t.Fatalf("len(Rows) = %d, want 1", len(got.Rows))
	}
	if len(got.Rows[0]) != 1 || got.Rows[0]["a"] != "1" {
		t.Errorf("row = %v, want just a=1", got.Rows[0])
	}
}

func TestParseXlsxFile_MultiSheet_ReadsFirstSheetOnly(t *testing.T) {
	cfg := newTestConfigureServiceForXlsx(t)
	f := excelize.NewFile()
	idx, err := f.NewSheet("Second")
	if err != nil {
		t.Fatalf("NewSheet: %v", err)
	}
	_ = idx
	if err := f.SetCellValue("Sheet1", "A1", "first-sheet-col"); err != nil {
		t.Fatalf("SetCellValue: %v", err)
	}
	if err := f.SetCellValue("Sheet1", "A2", "v"); err != nil {
		t.Fatalf("SetCellValue: %v", err)
	}
	if err := f.SetCellValue("Second", "A1", "second-sheet-col"); err != nil {
		t.Fatalf("SetCellValue: %v", err)
	}
	var buf bytes.Buffer
	if _, err := f.WriteTo(&buf); err != nil {
		t.Fatalf("WriteTo: %v", err)
	}
	if err := f.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	b64 := base64.StdEncoding.EncodeToString(buf.Bytes())

	got, err := cfg.ParseXlsxFile(b64)
	if err != nil {
		t.Fatalf("ParseXlsxFile: %v", err)
	}
	if want := []string{"first-sheet-col"}; !slices.Equal(got.FileColumns, want) {
		t.Errorf("FileColumns = %v, want %v (first sheet only)", got.FileColumns, want)
	}
}

func TestParseXlsxFile_InvalidBase64_Errors(t *testing.T) {
	cfg := newTestConfigureServiceForXlsx(t)
	if _, err := cfg.ParseXlsxFile("not-base64!!!"); err == nil {
		t.Fatal("want error for invalid base64, got nil")
	}
}

func TestParseXlsxFile_NotAWorkbook_Errors(t *testing.T) {
	cfg := newTestConfigureServiceForXlsx(t)
	b64 := base64.StdEncoding.EncodeToString([]byte("this is plainly not an xlsx file"))
	if _, err := cfg.ParseXlsxFile(b64); err == nil {
		t.Fatal("want error for non-xlsx bytes, got nil")
	}
}

func TestParseXlsxFile_EmptySheet_Errors(t *testing.T) {
	cfg := newTestConfigureServiceForXlsx(t)
	f := excelize.NewFile()
	var buf bytes.Buffer
	if _, err := f.WriteTo(&buf); err != nil {
		t.Fatalf("WriteTo: %v", err)
	}
	if err := f.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	b64 := base64.StdEncoding.EncodeToString(buf.Bytes())

	if _, err := cfg.ParseXlsxFile(b64); err == nil {
		t.Fatal("want error for an empty sheet (no header row), got nil")
	}
}

