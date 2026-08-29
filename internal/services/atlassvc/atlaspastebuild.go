package atlassvc

import (
	"fmt"
	"regexp"
	"sort"
	"strings"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/domain/typedfield"
)

// This file turns a decoded mxGraphModel (atlaspaste.go's ladder) into
// Mill's own primitives -- table shapes into a List + a "table" board
// object (goal 0179 S2), vertices into cards (nested via Atlas
// ParentID when the source drew a container), edges into labelled
// links. Deliberately NOT a fidelity mirror: style/colour are read
// only where a table shape must be detected (styleHasShape), never
// carried onto the created entity -- docs/goals/0194's "database
// pretending to be a diagram" framing: import turns presentation into
// queryable data, on purpose. A pasted vertex always becomes a plain
// Card here, never a styled "shape" board object, so no style key
// (fillColor, strokeColor, strokeWidth, rotation) has anywhere to
// land on this path -- goal 0214's own rotation field joins that same
// existing asymmetry rather than being a new gap, since fill/stroke
// never round-tripped through import either.

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

// pasteMultiTable lands one board object per table, offset like the
// multi-page drawio precedent -- shared by every recognizer that can
// produce more than one table from a single paste (HTML, and drawio's
// own multi-table selections).
func (a *AtlasService) pasteMultiTable(tables []pastedTable, parentID string, pos atlas.Position) (PasteResult, error) {
	res := PasteResult{Recognized: true}
	p := pos
	for _, t := range tables {
		if err := a.pasteOneTable(t, parentID, &p); err != nil {
			return res, err
		}
		res.Tables++
		p = atlas.Position{X: p.X + 40, Y: p.Y + 40}
	}
	return res, nil
}

func recognizeDrawioPaste(a *AtlasService, text, _, parentID string, pos atlas.Position) (PasteResult, bool, error) {
	model, skippedPages, ok := decodeDiagramText(text)
	if !ok {
		return PasteResult{}, false, nil
	}
	tables, rest := extractTables(model)
	res, err := a.pasteMultiTable(tables, parentID, pos)
	res.SkippedPages = skippedPages
	if err != nil {
		return res, true, err
	}
	cards, links, err := a.pasteDiagram(rest, parentID, pos.X, pos.Y)
	if err != nil {
		return res, true, err
	}
	res.Cards, res.Links = cards, links
	return res, true, nil
}

// recognizeHTMLTablePaste is the chain's HTML-table entry
// (docs/goals/0218): an M365 app's copied table arrives in the
// clipboard's text/html flavor, never TSV -- see detectHTMLTables in
// atlaspastehtml.go for the recognition rule itself.
func recognizeHTMLTablePaste(a *AtlasService, _, html, parentID string, pos atlas.Position) (PasteResult, bool, error) {
	tables, ok := detectHTMLTables(html)
	if !ok {
		return PasteResult{}, false, nil
	}
	res, err := a.pasteMultiTable(tables, parentID, pos)
	return res, true, err
}

// recognizeTSVPaste recognizes a copied Excel/Sheets range (goal 0138
// slice 2): tab-separated plain text becomes a Mill table through the
// same List path the diagram/HTML tables use.
func recognizeTSVPaste(a *AtlasService, text, _, parentID string, pos atlas.Position) (PasteResult, bool, error) {
	tsv, isTSV := detectTSV(text)
	if !isTSV {
		return PasteResult{}, false, nil
	}
	if err := a.pasteOneTable(tsv, parentID, &pos); err != nil {
		return PasteResult{Recognized: true}, true, err
	}
	return PasteResult{Recognized: true, Tables: 1}, true, nil
}

// pasteOneTable mints the List a table-shaped paste describes, then
// lands it as a "table" BoardObject -- a peer to Card, never a card
// itself (goal 0179's own correction: dropping/pasting something onto
// the board creates THAT THING). Unlike the pre-S2 behavior, no Kind is
// resolved and no card exists to promote automatically; Promote to
// card stays the explicit, reversible escape hatch (useAtlasObjectMenu.ts).
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
	_, err = a.CreateBoardObject("table", map[string]string{"listID": listID, "title": title}, *pos, parentID)
	return err
}

// pasteDiagram creates a card per vertex and a link per edge under
// parentID. Containment mirrors the source: a vertex whose mx Parent
// names another vertex in this paste lands inside that card via Atlas
// ParentID (any depth -- containmentOrder defers a vertex until its
// own container has a card); a vertex whose Parent isn't itself a
// vertex here (the page's root/layer cell, or a container that never
// decoded) lands at the paste's own parentID.
func (a *AtlasService) pasteDiagram(cells []mxCell, parentID string, x, y float64) (int, int, error) {
	minX, minY := vertexOrigin(cells)
	order := containmentOrder(vertexCells(cells))
	created := make(map[string]string, len(order))
	cards := 0
	for _, c := range order {
		title, note := splitVertexText(c.Value)
		cardParent := parentID
		if p, ok := created[c.Parent]; ok {
			cardParent = p
		}
		pos := &atlas.Position{X: x + geomX(c) - minX, Y: y + geomY(c) - minY}
		card, err := a.CreateCard(a.defaultProjectionKindLocked(), title, note, nil, cardParent, pos, "", "", "", "")
		if err != nil {
			return cards, 0, err
		}
		created[c.ID] = card.ID
		cards++
	}
	links, err := a.pasteEdges(cells, created)
	return cards, links, err
}

func vertexCells(cells []mxCell) []mxCell {
	var out []mxCell
	for _, c := range cells {
		if c.Vertex == "1" {
			out = append(out, c)
		}
	}
	return out
}

// containmentOrder returns vertices ordered so a container (any
// vertex named as another vertex's Parent) always precedes its
// children -- Atlas requires a card's parent to already exist
// (createCardWithID). Falls back to the input order for a Parent
// cycle, which mxGraph never legitimately produces, so no vertex is
// dropped waiting on a container that will never place.
func containmentOrder(vertices []mxCell) []mxCell {
	isVertex := make(map[string]bool, len(vertices))
	for _, c := range vertices {
		isVertex[c.ID] = true
	}
	placed := make(map[string]bool, len(vertices))
	order := make([]mxCell, 0, len(vertices))
	for len(order) < len(vertices) {
		progressed := false
		for _, c := range vertices {
			if placed[c.ID] || (isVertex[c.Parent] && !placed[c.Parent]) {
				continue
			}
			order = append(order, c)
			placed[c.ID] = true
			progressed = true
		}
		if !progressed {
			for _, c := range vertices {
				if !placed[c.ID] {
					order = append(order, c)
					placed[c.ID] = true
				}
			}
			break
		}
	}
	return order
}

var brTagPattern = regexp.MustCompile(`(?i)<br\s*/?>`)

// splitVertexText separates a vertex's first line as the card title
// from any remaining lines, which become the note. A source tool
// stores a multi-line vertex label as literal newlines or as <br>
// tags depending on its own HTML-label setting, so both are
// normalized to newlines before splitting.
func splitVertexText(value string) (string, string) {
	lines := strings.Split(brTagPattern.ReplaceAllString(value, "\n"), "\n")
	for i := range lines {
		lines[i] = strings.TrimSpace(lines[i])
	}
	title := lines[0]
	if title == "" {
		title = "Untitled"
	}
	note := strings.TrimSpace(strings.Join(lines[1:], "\n"))
	return title, note
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
