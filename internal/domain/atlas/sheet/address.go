// Package sheet is a CSV-backed content-plane domain (goal 0388): a
// "sheet" board object's own file, addressed the same A1 way MS
// Graph's workbookRange API addresses a real spreadsheet -- the
// sheet's counterpart to drawio.Document's cell-id addressing. Kept
// hand-written per .claude/rules/architecture.md's core-domain rule:
// Mill's own address model and edit semantics have no library
// opinion, only the CSV parse/serialize underneath does (encoding/csv,
// the same package atlassvc's own table export already uses -- never
// a hand-rolled split on commas).
package sheet

import (
	"fmt"
	"strconv"
	"strings"
)

// Address is one cell's zero-indexed column/row pair.
type Address struct {
	Col int
	Row int
}

// String renders back the A1 form ParseAddress accepts.
func (a Address) String() string {
	return fmt.Sprintf("%s%d", columnLetters(a.Col), a.Row+1)
}

func isASCIILetter(b byte) bool {
	return (b >= 'A' && b <= 'Z') || (b >= 'a' && b <= 'z')
}

// ParseAddress parses a single A1-style cell reference ("B7"), case-
// insensitive. Multi-letter columns (AA, AB, ..., AZ, BA, ...) follow
// the base-26 convention every spreadsheet uses.
func ParseAddress(s string) (Address, error) {
	raw := strings.TrimSpace(s)
	i := 0
	for i < len(raw) && isASCIILetter(raw[i]) {
		i++
	}
	if i == 0 || i == len(raw) {
		return Address{}, fmt.Errorf("%q is not a cell address -- want a column letter then a row number, like B7", s)
	}
	col, err := columnIndex(raw[:i])
	if err != nil {
		return Address{}, fmt.Errorf("%q is not a cell address: %w", s, err)
	}
	row, err := strconv.Atoi(raw[i:])
	if err != nil || row < 1 {
		return Address{}, fmt.Errorf("%q is not a cell address -- the row must be a positive number", s)
	}
	return Address{Col: col, Row: row - 1}, nil
}

// columnIndex converts a column's letters ("A", "Z", "AA", ...) to its
// zero-indexed position.
func columnIndex(letters string) (int, error) {
	n := 0
	for _, r := range strings.ToUpper(letters) {
		if r < 'A' || r > 'Z' {
			return 0, fmt.Errorf("%q is not a column letter", letters)
		}
		n = n*26 + int(r-'A'+1)
	}
	return n - 1, nil
}

// columnLetters is columnIndex's inverse: 0 -> "A", 25 -> "Z", 26 -> "AA".
func columnLetters(col int) string {
	col++
	var b []byte
	for col > 0 {
		col--
		b = append([]byte{byte('A' + col%26)}, b...)
		col /= 26
	}
	return string(b)
}

// Range is a rectangular, both-corners-inclusive A1:B2-style span.
type Range struct {
	Start, End Address
}

// String renders back the A1:B2 form ParseRange accepts, or the bare
// single-cell form when Start==End.
func (r Range) String() string {
	if r.Start == r.End {
		return r.Start.String()
	}
	return r.Start.String() + ":" + r.End.String()
}

// ParseRange parses either a single cell ("B7") or a two-corner span
// ("B2:D5"). A span's corners normalize so Start is always the
// top-left and End the bottom-right, regardless of the order given --
// "D5:B2" and "B2:D5" address the same range.
func ParseRange(s string) (Range, error) {
	before, after, hasColon := strings.Cut(strings.TrimSpace(s), ":")
	start, err := ParseAddress(before)
	if err != nil {
		return Range{}, err
	}
	if !hasColon {
		return Range{Start: start, End: start}, nil
	}
	end, err := ParseAddress(after)
	if err != nil {
		return Range{}, err
	}
	if end.Col < start.Col {
		start.Col, end.Col = end.Col, start.Col
	}
	if end.Row < start.Row {
		start.Row, end.Row = end.Row, start.Row
	}
	return Range{Start: start, End: end}, nil
}
