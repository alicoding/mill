// Package xlsx is a real .xlsx workbook's cell-range content plane
// (goal 0365 S1, ADR-0046's two-plane rule): the file on disk IS the
// content, so a read/edit call opens the actual workbook with
// excelize, touches only the named cells, and saves in place --
// everything else in the file (other sheets, styles, formulas, merged
// ranges) comes back unchanged. A1 addressing is shared with the CSV
// sheet contract (internal/domain/atlas/sheet) since both use the
// same spreadsheet convention; only the storage format differs, so
// only excelize's own read/write calls are new here.
//
// Recalculation is never performed: excelize stores a formula's own
// text and whatever cached value it already had, but has no formula
// engine, so a cell reads back its OLD cached value until the file
// next opens in a real spreadsheet app and recalculates.
package xlsx

import (
	"fmt"
	"strings"

	"github.com/alicoding/mill/internal/domain/atlas/sheet"
	"github.com/xuri/excelize/v2"
)

// Dimensions is one sheet's own used-range footprint, the xlsx
// counterpart to sheet.Dimensions.
type Dimensions struct {
	Rows int
	Cols int
}

// RangeResult is one read's answer: which sheet and range were
// actually read (a range resolves against the sheet's own bounds when
// the caller left it blank), the values as displayed, and, in the
// parallel Formulas grid, each cell's formula text where it holds one
// ("" otherwise) -- excelize's own GetCellValue/GetCellFormula split,
// carried through rather than collapsed, since a CSV cell has no such
// second axis to preserve.
type RangeResult struct {
	Sheet      string
	Range      string
	Values     [][]string
	Formulas   [][]string
	Dimensions Dimensions
}

// CellEdit names one cell's new content: EXACTLY one of Value or
// Formula must be set (both nil, or both set, is a caller error) --
// the same "one thing per cell" shape the sheet CSV contract's own
// CellEdit uses, extended with excelize's formula door. Value is
// written as the cell's literal text, the same convention the CSV
// sheet tool documents for its own Value field (encoding/csv has no
// numeric type either); a caller wanting a computed cell uses Formula
// instead.
type CellEdit struct {
	Address string
	Value   *string
	Formula *string
}

// SheetNames returns path's own sheet list, in workbook order.
func SheetNames(path string) ([]string, error) {
	f, err := excelize.OpenFile(path)
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", path, err)
	}
	defer func() { _ = f.Close() }()
	return f.GetSheetList(), nil
}

// resolveSheetName picks requested (or the workbook's first sheet
// when requested is blank), failing with every sheet name present so
// the caller can pick a real one without a second round trip.
func resolveSheetName(f *excelize.File, requested string) (string, error) {
	names := f.GetSheetList()
	if requested == "" {
		if len(names) == 0 {
			return "", fmt.Errorf("this workbook has no sheets")
		}
		return names[0], nil
	}
	for _, n := range names {
		if n == requested {
			return n, nil
		}
	}
	return "", fmt.Errorf("no sheet named %q -- this workbook has: %s", requested, strings.Join(names, ", "))
}

// sheetDimensions walks name's rows once to find its own used-range
// footprint -- GetSheetDimension's cached XML attribute can lag a
// workbook written by another tool, where a fresh count from the real
// cells never can.
func sheetDimensions(f *excelize.File, name string) (Dimensions, error) {
	rows, err := f.GetRows(name)
	if err != nil {
		return Dimensions{}, fmt.Errorf("read sheet %q: %w", name, err)
	}
	cols := 0
	for _, row := range rows {
		if len(row) > cols {
			cols = len(row)
		}
	}
	return Dimensions{Rows: len(rows), Cols: cols}, nil
}

// resolveRange parses a1Range, or answers name's whole used range
// when a1Range is blank.
func resolveRange(dims Dimensions, a1Range string) (sheet.Range, error) {
	if a1Range != "" {
		return sheet.ParseRange(a1Range)
	}
	if dims.Rows == 0 || dims.Cols == 0 {
		return sheet.Range{}, nil
	}
	return sheet.Range{
		Start: sheet.Address{Col: 0, Row: 0},
		End:   sheet.Address{Col: dims.Cols - 1, Row: dims.Rows - 1},
	}, nil
}

// readGrid reads rng's values and formulas from name, row-major,
// top-left first. A cell past the sheet's own written extent (or an
// unset cell inside it) reads as an empty string/no formula, never an
// error -- the same forgiving-past-the-edge rule sheet.Document.ReadRange
// follows.
func readGrid(f *excelize.File, name string, rng sheet.Range) ([][]string, [][]string, error) {
	rowCount := rng.End.Row - rng.Start.Row + 1
	colCount := rng.End.Col - rng.Start.Col + 1
	values := make([][]string, rowCount)
	formulas := make([][]string, rowCount)
	for r := 0; r < rowCount; r++ {
		values[r] = make([]string, colCount)
		formulas[r] = make([]string, colCount)
		for c := 0; c < colCount; c++ {
			cell, err := excelize.CoordinatesToCellName(rng.Start.Col+c+1, rng.Start.Row+r+1)
			if err != nil {
				return nil, nil, err
			}
			v, err := f.GetCellValue(name, cell)
			if err != nil {
				return nil, nil, fmt.Errorf("cell %s: %w", cell, err)
			}
			values[r][c] = v
			formula, err := f.GetCellFormula(name, cell)
			if err != nil {
				return nil, nil, fmt.Errorf("cell %s: %w", cell, err)
			}
			formulas[r][c] = formula
		}
	}
	return values, formulas, nil
}

// ReadRange reads a1Range (or the whole used range, when a1Range is
// blank) from sheetName (or the workbook's first sheet, when
// sheetName is blank) in the .xlsx file at path. Read-only: the file
// is opened, read and closed without ever being saved.
func ReadRange(path, sheetName, a1Range string) (RangeResult, error) {
	f, err := excelize.OpenFile(path)
	if err != nil {
		return RangeResult{}, fmt.Errorf("open %s: %w", path, err)
	}
	defer func() { _ = f.Close() }()

	name, err := resolveSheetName(f, sheetName)
	if err != nil {
		return RangeResult{}, err
	}
	dims, err := sheetDimensions(f, name)
	if err != nil {
		return RangeResult{}, err
	}
	rng, err := resolveRange(dims, a1Range)
	if err != nil {
		return RangeResult{}, err
	}
	values, formulas := [][]string{}, [][]string{}
	// An explicitly named range always reads (even past an empty
	// sheet's own extent, as all-empty cells); the default whole-sheet
	// range on a genuinely empty sheet stays an empty grid rather than
	// fabricating a 1x1 grid from the zero Range resolveRange answers.
	if a1Range != "" || (dims.Rows > 0 && dims.Cols > 0) {
		values, formulas, err = readGrid(f, name, rng)
		if err != nil {
			return RangeResult{}, err
		}
	}
	return RangeResult{Sheet: name, Range: rng.String(), Values: values, Formulas: formulas, Dimensions: dims}, nil
}

// parsedEdit is one CellEdit, address-parsed and shape-validated --
// every edit in a call is parsed and validated BEFORE any is applied,
// so a bad address or a malformed edit fails the whole call before
// anything is written (the same all-or-nothing guarantee
// sheet.Document.EditCells and the diagram write tools give).
type parsedEdit struct {
	cell    string
	value   *string
	formula string
	setsF   bool
}

func parseEdits(edits []CellEdit) ([]parsedEdit, error) {
	out := make([]parsedEdit, len(edits))
	for i, e := range edits {
		addr, err := sheet.ParseAddress(e.Address)
		if err != nil {
			return nil, err
		}
		if (e.Value == nil) == (e.Formula == nil) {
			return nil, fmt.Errorf("cell %s: name exactly one of value or formula", e.Address)
		}
		cell, err := excelize.CoordinatesToCellName(addr.Col+1, addr.Row+1)
		if err != nil {
			return nil, fmt.Errorf("cell %s: %w", e.Address, err)
		}
		p := parsedEdit{cell: cell, value: e.Value}
		if e.Formula != nil {
			p.formula = strings.TrimPrefix(*e.Formula, "=")
			p.setsF = true
		}
		out[i] = p
	}
	return out, nil
}

// EditCells changes ONLY the named cells of the .xlsx file at path
// (sheetName, or the workbook's first sheet when blank), via
// excelize's own SetCellValue/SetCellFormula on the already-opened
// workbook, then saves in place -- every other cell, style, sheet and
// formula in the file survives untouched. Nothing on disk changes
// when any edit is invalid.
func EditCells(path, sheetName string, edits []CellEdit) error {
	parsed, err := parseEdits(edits)
	if err != nil {
		return err
	}

	f, err := excelize.OpenFile(path)
	if err != nil {
		return fmt.Errorf("open %s: %w", path, err)
	}
	defer func() { _ = f.Close() }()

	name, err := resolveSheetName(f, sheetName)
	if err != nil {
		return err
	}

	for _, p := range parsed {
		if p.setsF {
			if err := f.SetCellFormula(name, p.cell, p.formula); err != nil {
				return fmt.Errorf("cell %s: %w", p.cell, err)
			}
			continue
		}
		if err := f.SetCellValue(name, p.cell, *p.value); err != nil {
			return fmt.Errorf("cell %s: %w", p.cell, err)
		}
	}

	if err := f.Save(); err != nil {
		return fmt.Errorf("save %s: %w", path, err)
	}
	return nil
}
