package atlassvc

import (
	"bytes"
	"compress/flate"
	"encoding/base64"
	"encoding/xml"
	"fmt"
	"io"
	"net/url"
	"sort"
	"strings"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/domain/typedfield"
)

// Paste understanding (docs/goals/0138): clipboard text that carries a
// diagramming tool's cell model becomes Mill's OWN primitives -- table
// shapes become a List + its projection card, plain vertices become
// cards, edges become links. Detection is a deterministic decode
// ladder, never a heuristic: parse as XML; else URI-decode; else
// base64+inflate+URI-decode (the tool's own three wire forms).

// mxCell is the diagram model's one node type; geometry carries
// placement for vertices and ordering for table rows/cells.
type mxCell struct {
	ID       string      `xml:"id,attr"`
	Value    string      `xml:"value,attr"`
	Style    string      `xml:"style,attr"`
	Vertex   string      `xml:"vertex,attr"`
	Edge     string      `xml:"edge,attr"`
	Parent   string      `xml:"parent,attr"`
	Source   string      `xml:"source,attr"`
	Target   string      `xml:"target,attr"`
	Geometry *mxGeometry `xml:"mxGeometry"`
}

type mxGeometry struct {
	X float64 `xml:"x,attr"`
	Y float64 `xml:"y,attr"`
	W float64 `xml:"width,attr"`
	H float64 `xml:"height,attr"`
}

type mxGraphModel struct {
	Cells []mxCell `xml:"root>mxCell"`
}

// mxFile wraps one or more diagrams; each diagram's content is either
// inline XML (uncompressed save format) or a compressed payload.
type mxFile struct {
	Diagrams []struct {
		Inline  *mxGraphModel `xml:"mxGraphModel"`
		Content string        `xml:",chardata"`
	} `xml:"diagram"`
}

// decodeDiagramText runs the decode ladder and returns the parsed
// model. ok=false means "not diagram-shaped at all" -- the caller
// leaves the paste alone.
func decodeDiagramText(text string) (mxGraphModel, bool) {
	text = strings.TrimSpace(text)
	if text == "" {
		return mxGraphModel{}, false
	}
	if m, ok := parseModelXML(text); ok {
		return m, true
	}
	if decoded, err := url.PathUnescape(text); err == nil && decoded != text {
		if m, ok := parseModelXML(strings.TrimSpace(decoded)); ok {
			return m, true
		}
	}
	return decodeBase64Deflate(text)
}

func decodeBase64Deflate(text string) (mxGraphModel, bool) {
	raw, err := base64.StdEncoding.DecodeString(text)
	if err != nil {
		return mxGraphModel{}, false
	}
	inflated, err := io.ReadAll(flate.NewReader(bytes.NewReader(raw)))
	if err != nil {
		return mxGraphModel{}, false
	}
	decoded, err := url.PathUnescape(string(inflated))
	if err != nil {
		return mxGraphModel{}, false
	}
	return parseModelXML(strings.TrimSpace(decoded))
}

func parseModelXML(text string) (mxGraphModel, bool) {
	if strings.HasPrefix(text, "<mxGraphModel") {
		var m mxGraphModel
		if xml.Unmarshal([]byte(text), &m) == nil && len(m.Cells) > 0 {
			return m, true
		}
		return mxGraphModel{}, false
	}
	if strings.HasPrefix(text, "<mxfile") {
		return parseMxFile(text)
	}
	return mxGraphModel{}, false
}

func parseMxFile(text string) (mxGraphModel, bool) {
	var f mxFile
	if xml.Unmarshal([]byte(text), &f) != nil {
		return mxGraphModel{}, false
	}
	for _, d := range f.Diagrams {
		if d.Inline != nil && len(d.Inline.Cells) > 0 {
			return *d.Inline, true
		}
		if m, ok := decodeDiagramText(strings.TrimSpace(d.Content)); ok {
			return m, true
		}
	}
	return mxGraphModel{}, false
}

func styleHasShape(style, shape string) bool {
	return strings.HasPrefix(style, "shape="+shape) || strings.Contains(style, ";shape="+shape)
}

// pastedTable is one table shape lifted out of the model: ordered
// rows of ordered cell values.
type pastedTable struct {
	Label string
	Rows  [][]string
}

// extractTables pulls table-shaped containers out and returns the
// remaining cells (everything not part of any table).
func extractTables(m mxGraphModel) ([]pastedTable, []mxCell) {
	byParent := make(map[string][]mxCell)
	for _, c := range m.Cells {
		byParent[c.Parent] = append(byParent[c.Parent], c)
	}
	inTable := make(map[string]bool)
	var tables []pastedTable
	for _, c := range m.Cells {
		if c.Vertex != "1" || !styleHasShape(c.Style, "table") || styleHasShape(c.Style, "tableRow") {
			continue
		}
		inTable[c.ID] = true
		rows := append([]mxCell(nil), byParent[c.ID]...)
		sort.Slice(rows, func(i, j int) bool { return geomY(rows[i]) < geomY(rows[j]) })
		var tbl pastedTable
		tbl.Label = strings.TrimSpace(c.Value)
		for _, row := range rows {
			inTable[row.ID] = true
			cells := append([]mxCell(nil), byParent[row.ID]...)
			sort.Slice(cells, func(i, j int) bool { return geomX(cells[i]) < geomX(cells[j]) })
			var values []string
			for _, cell := range cells {
				inTable[cell.ID] = true
				values = append(values, strings.TrimSpace(cell.Value))
			}
			tbl.Rows = append(tbl.Rows, values)
		}
		tables = append(tables, tbl)
	}
	var rest []mxCell
	for _, c := range m.Cells {
		if !inTable[c.ID] && !inTable[c.Parent] {
			rest = append(rest, c)
		}
	}
	return tables, rest
}

func geomX(c mxCell) float64 {
	if c.Geometry == nil {
		return 0
	}
	return c.Geometry.X
}

func geomY(c mxCell) float64 {
	if c.Geometry == nil {
		return 0
	}
	return c.Geometry.Y
}

// tableColumns decides the List schema: the first row becomes headers
// when every value is non-empty; otherwise Column N. Keys are slugged
// from the header the same way the grid's own rename re-keying does.
func tableColumns(t pastedTable) ([]typedfield.Field, [][]string) {
	width := 0
	for _, r := range t.Rows {
		if len(r) > width {
			width = len(r)
		}
	}
	if width == 0 {
		return nil, nil
	}
	headers, dataRows := detectHeaders(t.Rows, width)
	fields := make([]typedfield.Field, 0, width)
	seen := make([]string, 0, width)
	for _, h := range headers {
		key := slugColumnKey(h, seen)
		seen = append(seen, key)
		fields = append(fields, typedfield.Field{Key: key, Label: h, Type: typedfield.TypeText})
	}
	return fields, dataRows
}

// detectHeaders promotes the first row to column headers when every
// value is non-empty; otherwise every column is "Column N" and all
// rows are data.
func detectHeaders(rows [][]string, width int) ([]string, [][]string) {
	headers := make([]string, width)
	if len(rows) > 1 {
		complete := true
		for i := 0; i < width; i++ {
			v := ""
			if i < len(rows[0]) {
				v = rows[0][i]
			}
			if v == "" {
				complete = false
				break
			}
			headers[i] = v
		}
		if complete {
			return headers, rows[1:]
		}
	}
	for i := range headers {
		headers[i] = fmt.Sprintf("Column %d", i+1)
	}
	return headers, rows
}

// slugColumnKey mirrors the frontend grid's nextColumnKey slugging so
// a pasted "Status" column and a grid-authored one get the same key.
func slugColumnKey(label string, taken []string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(strings.TrimSpace(label)) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
		case b.Len() > 0 && !strings.HasSuffix(b.String(), "-"):
			b.WriteByte('-')
		}
	}
	base := strings.Trim(b.String(), "-")
	if base == "" {
		base = "column"
	}
	key := base
	for n := 2; contains(taken, key); n++ {
		key = fmt.Sprintf("%s-%d", base, n)
	}
	return key
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

// PasteResult reports what a paste became; Recognized=false means the
// text wasn't diagram-shaped and nothing was created.
type PasteResult struct {
	Recognized bool
	Cards      int
	Links      int
	Tables     int
}

// WirePasteListWrites installs the Configure-owned write seams the
// table conversion runs through (wired from the composition root,
// backend.md's injected-func rule).
//
//wails:ignore
func (a *AtlasService) WirePasteListWrites(factory func(label string, columns []typedfield.Field) (string, error), appendRow func(listID string, values map[string]string) error) {
	a.pasteListFactory = factory
	a.pasteRowAppender = appendRow
}

// PasteToBoard converts understood clipboard text into entities under
// parentID, starting placement at (x, y). A user's own paste is a
// direct edit -- ungated, like every direct create.
func (a *AtlasService) PasteToBoard(text, parentID string, x, y float64) (PasteResult, error) {
	model, ok := decodeDiagramText(text)
	if !ok {
		// Spreadsheet-shaped text (goal 0138 slice 2): a copied Excel/
		// Sheets range arrives as TSV -- it becomes a Mill table
		// through the same List path the diagram tables use.
		if tsv, isTSV := detectTSV(text); isTSV {
			if err := a.pasteOneTable(tsv, parentID, &atlas.Position{X: x, Y: y}); err != nil {
				return PasteResult{Recognized: true}, err
			}
			return PasteResult{Recognized: true, Tables: 1}, nil
		}
		return PasteResult{}, nil
	}
	tables, rest := extractTables(model)
	res := PasteResult{Recognized: true}

	pos := &atlas.Position{X: x, Y: y}
	for _, t := range tables {
		if err := a.pasteOneTable(t, parentID, pos); err != nil {
			return res, err
		}
		res.Tables++
		pos = &atlas.Position{X: pos.X + 40, Y: pos.Y + 40}
	}

	cards, links, err := a.pasteDiagram(rest, parentID, x, y)
	if err != nil {
		return res, err
	}
	res.Cards, res.Links = cards, links
	return res, nil
}

func (a *AtlasService) pasteOneTable(t pastedTable, parentID string, pos *atlas.Position) error {
	if a.pasteListFactory == nil || a.pasteRowAppender == nil {
		return fmt.Errorf("table paste is not available in this build")
	}
	fields, dataRows := tableColumns(t)
	if len(fields) == 0 {
		return nil
	}
	title := t.Label
	if title == "" {
		title = "Imported table"
	}
	listID, err := a.pasteListFactory(title, fields)
	if err != nil {
		return err
	}
	for _, row := range dataRows {
		values := make(map[string]string, len(fields))
		for i, f := range fields {
			if i < len(row) {
				values[f.Key] = row[i]
			}
		}
		if err := a.pasteRowAppender(listID, values); err != nil {
			return err
		}
	}
	_, err = a.CreateListProjectionCard("", title, parentID, pos, listID)
	return err
}

func (a *AtlasService) pasteDiagram(cells []mxCell, parentID string, x, y float64) (int, int, error) {
	minX, minY := vertexOrigin(cells)
	created := make(map[string]string)
	cards := 0
	for _, c := range cells {
		if c.Vertex != "1" {
			continue
		}
		title := strings.TrimSpace(c.Value)
		if title == "" {
			title = "Untitled"
		}
		pos := &atlas.Position{X: x + geomX(c) - minX, Y: y + geomY(c) - minY}
		card, err := a.CreateCard(a.defaultProjectionKindLocked(), title, "", nil, parentID, pos, "", "", "", "")
		if err != nil {
			return cards, 0, err
		}
		created[c.ID] = card.ID
		cards++
	}
	links, err := a.pasteEdges(cells, created)
	return cards, links, err
}

// vertexOrigin finds the selection's top-left, so pasted geometry
// lands offset to the paste point rather than at the tool's absolute
// coordinates.
func vertexOrigin(cells []mxCell) (float64, float64) {
	minX, minY := 0.0, 0.0
	first := true
	for _, c := range cells {
		if c.Vertex != "1" || c.Geometry == nil {
			continue
		}
		if first || c.Geometry.X < minX {
			minX = c.Geometry.X
		}
		if first || c.Geometry.Y < minY {
			minY = c.Geometry.Y
		}
		first = false
	}
	return minX, minY
}

func (a *AtlasService) pasteEdges(cells []mxCell, created map[string]string) (int, error) {
	links := 0
	linkKind := a.defaultLinkKindID()
	for _, c := range cells {
		if c.Edge != "1" {
			continue
		}
		from, okF := created[c.Source]
		to, okT := created[c.Target]
		if !okF || !okT || linkKind == "" {
			continue
		}
		if _, err := a.CreateLink(from, to, linkKind, strings.TrimSpace(c.Value)); err != nil {
			return links, err
		}
		links++
	}
	return links, nil
}

func (a *AtlasService) defaultLinkKindID() string {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if len(a.linkKinds) == 0 {
		return ""
	}
	return a.linkKinds[0].ID
}

// detectTSV recognizes a spreadsheet-shaped text/plain payload (what
// a spreadsheet's copy puts alongside its HTML): at least two lines,
// every line carrying the SAME number of tabs (>=1) -- deterministic,
// so prose that happens to contain a tab never converts. First row
// becomes headers by the same rule tables use (detectHeaders).
func detectTSV(text string) (pastedTable, bool) {
	text = strings.TrimRight(strings.TrimPrefix(text, "\ufeff"), "\n\r")
	if !strings.Contains(text, "\t") {
		return pastedTable{}, false
	}
	lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	if len(lines) < 2 {
		return pastedTable{}, false
	}
	tabs := strings.Count(lines[0], "\t")
	if tabs < 1 {
		return pastedTable{}, false
	}
	var t pastedTable
	t.Label = "Imported table"
	for _, line := range lines {
		if strings.Count(line, "\t") != tabs {
			return pastedTable{}, false
		}
		cells := strings.Split(line, "\t")
		for i := range cells {
			cells[i] = strings.TrimSpace(cells[i])
		}
		t.Rows = append(t.Rows, cells)
	}
	return t, true
}
