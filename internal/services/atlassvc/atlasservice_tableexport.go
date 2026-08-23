package atlassvc

import (
	"bytes"
	"encoding/base64"
	"encoding/csv"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/xuri/excelize/v2"

	"github.com/alicoding/mill/internal/domain/typedfield"
)

// Table-projection Export-as (ADR-0043 §3, goal 0133 slice E2):
// csv/tsv/markdown-table/xlsx. Entity-backed data (a List's Columns +
// Rows) serializes in Go per ADR-0043 §4 -- the same split
// MirrorRawBytes (file-backed) already draws for the file-backed
// units. All four formats read the SAME resolved ListProjection the
// board/card page already renders (a.listProjection, wired via
// WireListProjection), so the export is always exactly what the user
// sees: no separate re-fetch, no row/status filtering divergence.

// TableProjectionExportResult is TableProjectionExport's wire shape --
// bytes travel as base64 (the MirrorContent/ParsedXlsxFile precedent),
// filename alongside since a projection card has no MirrorPath for the
// frontend to derive one from itself.
type TableProjectionExportResult struct {
	Filename string
	Data     string // base64-encoded
}

// tableExportMaxRows guards the same class of unbounded-payload risk
// mirrorPreviewMaxBytes guards for files -- a List has no independent
// size cap today, so export (which loads every row into memory at
// once, unlike the grid's own paged rendering) draws one explicitly.
const tableExportMaxRows = 50_000

// TableProjectionExport serializes cardID's projected List into format
// ("csv", "tsv", "markdown", or "xlsx") and returns it ready to
// download. An unresolvable card/list, an unrecognized format, or a
// serialization error all fail closed with an actionable message --
// never a silent empty download.
func (a *AtlasService) TableProjectionExport(cardID, format string) (TableProjectionExportResult, error) {
	a.mu.RLock()
	idx := a.findCardLocked(cardID)
	if idx == -1 {
		a.mu.RUnlock()
		return TableProjectionExportResult{}, fmt.Errorf("no card with id %q", cardID)
	}
	listID := a.cards[idx].ProjectionListID
	a.mu.RUnlock()
	if listID == "" {
		return TableProjectionExportResult{}, fmt.Errorf("card %q has no table projection", cardID)
	}
	if a.listProjection == nil {
		return TableProjectionExportResult{}, fmt.Errorf("table export: list projection is not available in this build")
	}
	proj, ok := a.listProjection(listID)
	if !ok || proj.Missing {
		return TableProjectionExportResult{}, fmt.Errorf("table export: the projected List no longer exists")
	}
	if len(proj.Rows) > tableExportMaxRows {
		return TableProjectionExportResult{}, fmt.Errorf("table export: %d rows is over the %d row export limit", len(proj.Rows), tableExportMaxRows)
	}

	data, ext, err := serializeTableProjection(proj.Columns, proj.Rows, format)
	if err != nil {
		return TableProjectionExportResult{}, fmt.Errorf("table export: %w", err)
	}
	label := proj.Label
	if label == "" {
		label = listID
	}
	return TableProjectionExportResult{
		Filename: filenameSlug(label) + ext,
		Data:     base64.StdEncoding.EncodeToString(data),
	}, nil
}

// serializeTableProjection is the pure format dispatch -- no I/O, unit-
// testable directly (mirroring atlas.ClassifyMirrorKind's own pure-
// predicate shape, one layer down into serialization).
func serializeTableProjection(columns []ProjectionColumn, rows []ProjectionRow, format string) (data []byte, ext string, err error) {
	switch format {
	case "csv":
		data, err = serializeDelimited(columns, rows, ',')
		return data, ".csv", err
	case "tsv":
		data, err = serializeDelimited(columns, rows, '\t')
		return data, ".tsv", err
	case "markdown":
		return serializeMarkdownTable(columns, rows), ".md", nil
	case "xlsx":
		data, err = serializeXLSX(columns, rows)
		return data, ".xlsx", err
	default:
		return nil, "", fmt.Errorf("unrecognized export format %q", format)
	}
}

// cellText resolves one row's value for one column -- a missing key
// (a row that predates a since-added column) reads as "", same as the
// grid's own display and xlsx import's ragged-row handling.
func cellText(row ProjectionRow, col ProjectionColumn) string {
	return row.Values[col.Key]
}

// serializeDelimited backs both csv and tsv -- the same
// encoding/csv.Writer with only Comma differing (ADR-0043 §4/the goal
// brief: tsv is not a separate implementation). Column headers are
// each column's Label, not its Key -- the user sees labels everywhere
// else the grid renders this same data. Every cell writes its stored
// string value as-is: List row values are already canonical strings on
// the wire (typedfield's own repo-wide convention), so csv/tsv need no
// per-type formatting -- only xlsx gets typed cells, since only xlsx
// can hold them.
func serializeDelimited(columns []ProjectionColumn, rows []ProjectionRow, comma rune) ([]byte, error) {
	var buf bytes.Buffer
	w := csv.NewWriter(&buf)
	w.Comma = comma

	header := make([]string, len(columns))
	for i, col := range columns {
		header[i] = col.Label
	}
	if err := w.Write(header); err != nil {
		return nil, fmt.Errorf("write header: %w", err)
	}

	for _, row := range rows {
		record := make([]string, len(columns))
		for i, col := range columns {
			record[i] = cellText(row, col)
		}
		if err := w.Write(record); err != nil {
			return nil, fmt.Errorf("write row: %w", err)
		}
	}
	w.Flush()
	if err := w.Error(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// markdownEscape guards a GFM table's own two structural characters: a
// literal "|" would otherwise close the cell early, and an embedded
// newline would break the row onto a second table line entirely. Both
// collapse to a safe single-line substitute rather than being dropped,
// so no data silently vanishes from the export.
func markdownEscape(v string) string {
	v = strings.ReplaceAll(v, "\r\n", " ")
	v = strings.ReplaceAll(v, "\n", " ")
	v = strings.ReplaceAll(v, "|", "\\|")
	return v
}

// serializeMarkdownTable hand-rolls GFM table syntax -- ~20 lines, no
// commodity worth adopting for this (the goal brief's own call). A
// table with zero columns still emits a well-formed (empty) table
// rather than nothing, matching csv/xlsx's own behavior on an empty
// schema.
func serializeMarkdownTable(columns []ProjectionColumn, rows []ProjectionRow) []byte {
	var b strings.Builder
	b.WriteByte('|')
	for _, col := range columns {
		b.WriteByte(' ')
		b.WriteString(markdownEscape(col.Label))
		b.WriteString(" |")
	}
	b.WriteByte('\n')
	b.WriteByte('|')
	for range columns {
		b.WriteString(" --- |")
	}
	b.WriteByte('\n')
	for _, row := range rows {
		b.WriteByte('|')
		for _, col := range columns {
			b.WriteByte(' ')
			b.WriteString(markdownEscape(cellText(row, col)))
			b.WriteString(" |")
		}
		b.WriteByte('\n')
	}
	return []byte(b.String())
}

// serializeXLSX writes a real workbook via excelize (already in
// go.mod from slice 4's xlsx->List import). Number/integer/boolean
// columns get NATIVE typed cells -- excelize can carry real types, so
// a downstream sort/sum in Excel works without a re-parse; every other
// column (including date/datetime, deliberately -- see setTypedCell)
// writes its stored string as a plain text cell. An empty stored value
// is left as a genuinely empty cell for every type rather than writing
// "0"/"FALSE"/"".
func serializeXLSX(columns []ProjectionColumn, rows []ProjectionRow) ([]byte, error) {
	f := excelize.NewFile()
	defer func() { _ = f.Close() }()
	sheet := f.GetSheetName(0)

	for i, col := range columns {
		cell, err := excelize.CoordinatesToCellName(i+1, 1)
		if err != nil {
			return nil, err
		}
		if err := f.SetCellStr(sheet, cell, col.Label); err != nil {
			return nil, err
		}
	}

	for r, row := range rows {
		for c, col := range columns {
			cell, err := excelize.CoordinatesToCellName(c+1, r+2)
			if err != nil {
				return nil, err
			}
			if err := setTypedCell(f, sheet, cell, cellText(row, col), col.Type); err != nil {
				return nil, err
			}
		}
	}

	buf, err := f.WriteToBuffer()
	if err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// setTypedCell writes v into cell, typed by colType where xlsx can
// actually represent the type natively and the stored string parses
// cleanly -- otherwise (including TypeDate/TypeDatetime, an empty v,
// or a value that fails to parse) it falls back to a plain string
// cell. Dates stay plain strings deliberately: xlsx dates are stored
// as serial-number floats with a separate number format, which needs
// a timezone-safe parse of Mill's own stored date string plus a chosen
// display format -- real scope, not a one-line typed-cell case, so v1
// keeps every date cell as its own honest ISO string rather than
// half-implementing Excel date semantics.
func setTypedCell(f *excelize.File, sheet, cell, v string, colType string) error {
	if v == "" {
		return nil
	}
	switch typedfield.Type(colType) {
	case typedfield.TypeNumber:
		if n, err := strconv.ParseFloat(v, 64); err == nil {
			return f.SetCellFloat(sheet, cell, n, -1, 64)
		}
	case typedfield.TypeInteger:
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			return f.SetCellValue(sheet, cell, n)
		}
	case typedfield.TypeBoolean:
		if b, err := strconv.ParseBool(v); err == nil {
			return f.SetCellBool(sheet, cell, b)
		}
	}
	return f.SetCellStr(sheet, cell, v)
}

var filenameUnsafe = regexp.MustCompile(`[^a-zA-Z0-9]+`)

// filenameSlug turns a List's Label into a safe bare filename stem
// (extension appended by the caller) -- the same collapse-to-hyphen
// shape seeding.NewSlugID uses for entity IDs, minus its random
// suffix (a download filename wants to be recognizable, not unique).
func filenameSlug(label string) string {
	slug := strings.Trim(filenameUnsafe.ReplaceAllString(label, "-"), "-")
	if slug == "" {
		return "table"
	}
	return slug
}
