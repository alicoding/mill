package sheet

import (
	"bytes"
	"encoding/csv"
	"fmt"
	"strings"
)

// Document is a CSV file's grid, held as plain rows so a range read or
// a cell edit can address it the same way a spreadsheet's own grid
// does. Rows may be ragged (a short row reads as empty past its own
// end) -- real spreadsheet content, not a parse error.
type Document struct {
	rows [][]string
}

// ParseDocument reads text as CSV. FieldsPerRecord is left unbounded
// (-1) so a ragged sheet parses instead of failing.
func ParseDocument(text string) (*Document, error) {
	if strings.TrimSpace(text) == "" {
		return &Document{}, nil
	}
	r := csv.NewReader(strings.NewReader(text))
	r.FieldsPerRecord = -1
	rows, err := r.ReadAll()
	if err != nil {
		return nil, fmt.Errorf("not readable as CSV: %w", err)
	}
	return &Document{rows: rows}, nil
}

// Dimensions is the grid's own footprint: Rows is how many rows it
// holds, Cols the longest row's length.
type Dimensions struct {
	Rows int `json:"rows"`
	Cols int `json:"cols"`
}

// Dimensions reports d's current footprint.
func (d *Document) Dimensions() Dimensions {
	cols := 0
	for _, row := range d.rows {
		if len(row) > cols {
			cols = len(row)
		}
	}
	return Dimensions{Rows: len(d.rows), Cols: cols}
}

// cell reads one address, "" past the sheet's own written extent -- a
// spreadsheet convention: an unwritten cell is empty, not an error.
func (d *Document) cell(a Address) string {
	if a.Row < 0 || a.Row >= len(d.rows) || a.Col < 0 || a.Col >= len(d.rows[a.Row]) {
		return ""
	}
	return d.rows[a.Row][a.Col]
}

// UsedRange is the smallest range covering every row/column the sheet
// currently holds -- ResolveRange's own default when a caller omits a
// range, the same "whole sheet" convenience Excel's own usedRange
// offers. The zero Range on an empty sheet.
func (d *Document) UsedRange() Range {
	dims := d.Dimensions()
	if dims.Rows == 0 || dims.Cols == 0 {
		return Range{}
	}
	return Range{Start: Address{Col: 0, Row: 0}, End: Address{Col: dims.Cols - 1, Row: dims.Rows - 1}}
}

// ResolveRange parses rangeAddr, or answers UsedRange when rangeAddr
// is empty -- the whole-sheet read a caller gets by naming no range.
func (d *Document) ResolveRange(rangeAddr string) (Range, error) {
	if strings.TrimSpace(rangeAddr) == "" {
		return d.UsedRange(), nil
	}
	return ParseRange(rangeAddr)
}

// ReadRange returns rng's values as a 2-D array, row-major, top-left
// first -- a cell past the sheet's own written extent reads as "",
// never an error.
func (d *Document) ReadRange(rng Range) [][]string {
	out := make([][]string, 0, rng.End.Row-rng.Start.Row+1)
	for row := rng.Start.Row; row <= rng.End.Row; row++ {
		line := make([]string, 0, rng.End.Col-rng.Start.Col+1)
		for col := rng.Start.Col; col <= rng.End.Col; col++ {
			line = append(line, d.cell(Address{Col: col, Row: row}))
		}
		out = append(out, line)
	}
	return out
}

// CellEdit is one address/value pair EditCells applies.
type CellEdit struct {
	Address string
	Value   string
}

// newRowWidth is how wide a brand-new padding row is created: encoding/
// csv's own Reader treats a record of exactly one empty field as a
// blank line and drops it on the next parse (its documented "blank
// lines are ignored" behavior) -- a real ambiguity CSV itself carries,
// not a Mill bug, and unavoidable on a sheet that only ever had one
// column. Padding a brand-new row out to the sheet's OWN current width
// (when that width is 2 or more) keeps it a real, re-parseable
// all-empty row instead of a line encoding/csv reads back as absent.
func newRowWidth(d *Document) int {
	if w := d.Dimensions().Cols; w > 1 {
		return w
	}
	return 1
}

// EditCells applies every edit, addressed by cell. Every address is
// parsed FIRST, so a single bad address fails the whole call before
// anything is written -- the same all-or-nothing guarantee the
// diagram tools' own patch/delete calls give. A short row (or a row
// that doesn't exist yet) pads with empty fields only as far as the
// edited cell, the frontend's own quick-edit convention
// (atlasCsvQuickEdit.ts's serializeCellEdit) so a round trip through
// either door lands the same shape.
func (d *Document) EditCells(edits []CellEdit) (int, error) {
	addrs := make([]Address, len(edits))
	for i, e := range edits {
		a, err := ParseAddress(e.Address)
		if err != nil {
			return 0, err
		}
		addrs[i] = a
	}
	padWidth := newRowWidth(d)
	for i, e := range edits {
		a := addrs[i]
		for len(d.rows) <= a.Row {
			d.rows = append(d.rows, make([]string, padWidth))
		}
		row := d.rows[a.Row]
		for len(row) <= a.Col {
			row = append(row, "")
		}
		row[a.Col] = e.Value
		d.rows[a.Row] = row
	}
	return len(edits), nil
}

// Marshal writes the grid back out as CSV.
func (d *Document) Marshal() (string, error) {
	var buf bytes.Buffer
	w := csv.NewWriter(&buf)
	for _, row := range d.rows {
		if err := w.Write(row); err != nil {
			return "", err
		}
	}
	w.Flush()
	if err := w.Error(); err != nil {
		return "", err
	}
	return buf.String(), nil
}
