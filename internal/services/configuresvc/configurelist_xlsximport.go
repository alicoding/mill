package configuresvc

import (
	"bytes"
	"encoding/base64"
	"fmt"

	"github.com/xuri/excelize/v2"
)

// ParsedXlsxFile mirrors listRowImportParse.ts's own ParsedFile shape
// (frontend/src/configure/listRowImportParse.ts) field-for-field, so
// xlsx rows feed the identical mapping/inference pipeline the CSV/JSON
// import path already owns -- this struct is the ONLY new surface;
// autoMatchColumns, mapRowValues, and inferListSchema never learn xlsx
// exists (docs/goals/0133 slice 4).
type ParsedXlsxFile struct {
	FileColumns []string
	Rows        []map[string]string
}

// ParseXlsxFile decodes base64Data (standard encoding) as an .xlsx
// workbook and returns its rows in the same header-row, string-cell
// shape parseImportFile's CSV branch produces (Papa Parse's
// `header: true`), so xlsx and CSV imports behave identically once
// parsed.
//
// First sheet only (GetSheetList()[0], the workbook's own declared
// order): the smallest honest v1 rather than a sheet picker -- a real
// future addition, not built here.
//
// The first row is the header. A ragged data row -- GetRows trims
// each row to its own last non-empty cell -- reads its missing
// trailing cells as "", the same as a short CSV row against a longer
// header; a row with MORE cells than the header has its extra
// trailing cells dropped, since there is no column name to hold them.
// A fully blank row (no cells at all) is skipped, matching Papa
// Parse's skipEmptyLines the CSV branch already sets.
func (c *ConfigureService) ParseXlsxFile(base64Data string) (ParsedXlsxFile, error) {
	data, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return ParsedXlsxFile{}, fmt.Errorf("parse xlsx: decode: %w", err)
	}
	f, err := excelize.OpenReader(bytes.NewReader(data))
	if err != nil {
		return ParsedXlsxFile{}, fmt.Errorf("parse xlsx: open: %w", err)
	}
	defer func() { _ = f.Close() }()

	sheets := f.GetSheetList()
	if len(sheets) == 0 {
		return ParsedXlsxFile{}, fmt.Errorf("parse xlsx: workbook has no sheets")
	}
	rows, err := f.GetRows(sheets[0])
	if err != nil {
		return ParsedXlsxFile{}, fmt.Errorf("parse xlsx: read sheet %q: %w", sheets[0], err)
	}
	if len(rows) == 0 {
		return ParsedXlsxFile{}, fmt.Errorf("parse xlsx: sheet %q is empty", sheets[0])
	}

	header := rows[0]
	out := ParsedXlsxFile{FileColumns: header, Rows: make([]map[string]string, 0, len(rows)-1)}
	for _, row := range rows[1:] {
		if len(row) == 0 {
			continue
		}
		r := make(map[string]string, len(header))
		for i, col := range header {
			if i < len(row) {
				r[col] = row[i]
			} else {
				r[col] = ""
			}
		}
		out.Rows = append(out.Rows, r)
	}
	return out, nil
}
