package atlassvc

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/PuerkitoBio/goquery"
	"github.com/alicoding/mill/internal/adapters/htmlextract"
)

// HTML-table paste recognition (docs/goals/0218): an M365 app (Word,
// Outlook, Teams, OneNote) carries a copied table in the clipboard's
// text/html flavor, not TSV plain text -- this is the paste chain's
// SECOND recognizer entry (atlaspastebuild.go's pasteRecognizers),
// tried after the drawio decode ladder and before TSV. A payload
// recognizes when it contains at least one top-level <table> AND the
// text OUTSIDE every table totals under htmlTableProseThreshold
// characters (trimmed): a table embedded in substantial prose is a
// document, left to the fallback note instead.
const htmlTableProseThreshold = 200

// detectHTMLTables parses html and returns one pastedTable per
// top-level <table> element found, in document order (a table nested
// inside another table's cell is walked as part of its parent's cell
// text, never counted separately -- goquery's own Text() already
// flattens it). ok is false when html isn't table-recognized at all
// (no table, unparseable, or too much prose outside every table) -- the
// caller then tries the next recognizer in the chain.
func detectHTMLTables(html string) ([]pastedTable, bool) {
	trimmed := strings.TrimSpace(html)
	if trimmed == "" {
		return nil, false
	}
	root, err := htmlextract.Parse(trimmed)
	if err != nil {
		return nil, false
	}
	tableSel := root.Find("table").FilterFunction(func(_ int, s *goquery.Selection) bool {
		return s.ParentsFiltered("table").Length() == 0
	})
	if tableSel.Length() == 0 {
		return nil, false
	}
	if outsideTableProseLength(root) >= htmlTableProseThreshold {
		return nil, false
	}
	var tables []pastedTable
	total := tableSel.Length()
	tableSel.Each(func(i int, t *goquery.Selection) {
		rows := htmlTableRows(t)
		if len(rows) == 0 {
			return
		}
		tables = append(tables, pastedTable{Label: htmlTableLabel(t, i, total), Rows: rows})
	})
	return tables, len(tables) > 0
}

// outsideTableProseLength measures the parsed payload's own BODY text
// with every table/style/script node removed -- scoped to <body>
// (never <head>) so a Word export's own <style> block full of
// @font-face declarations, which net/html silently hoists into <head>,
// can never be counted as pasted prose. Walks a cloned selection so the
// caller's own later table walk still sees the original tree intact.
func outsideTableProseLength(root *goquery.Selection) int {
	scope := root.Find("body")
	if scope.Length() == 0 {
		scope = root
	}
	clone := scope.Clone()
	clone.Find("table, style, script").Remove()
	return len(strings.TrimSpace(clone.Text()))
}

// htmlTableLabel prefers the table's own <caption>; multiple tables in
// one payload (the multi-page drawio precedent) get numbered so their
// minted Lists never collide on name.
func htmlTableLabel(t *goquery.Selection, index, total int) string {
	if caption := strings.TrimSpace(t.ChildrenFiltered("caption").First().Text()); caption != "" {
		return caption
	}
	if total > 1 {
		return fmt.Sprintf("Pasted table %d", index+1)
	}
	return "Pasted table"
}

// tableRowSelection returns a <table>'s own direct rows in document
// order, whether they sit in an explicit/implicit thead/tbody/tfoot or
// bare as the table's own children -- ChildrenFiltered, not Find,
// keeps a NESTED table's own rows out of this walk (cascadia, the
// selector engine goquery is built on, doesn't support a bare `>`
// combinator as a selector's own first token, so this can't be
// expressed as one CSS string). A real parsed document never mixes
// bare and grouped rows in the same table -- the HTML5 parser wraps
// every bare <tr> run into an implicit tbody -- so concatenating both
// is safe without a document-order merge.
func tableRowSelection(table *goquery.Selection) *goquery.Selection {
	rows := table.ChildrenFiltered("tr")
	table.ChildrenFiltered("thead, tbody, tfoot").Each(func(_ int, g *goquery.Selection) {
		rows = rows.AddSelection(g.ChildrenFiltered("tr"))
	})
	return rows
}

// rowSpanCarry is one column's still-active rowspan: the cell's own
// text, and how many further rows it still covers.
type rowSpanCarry struct {
	text      string
	remaining int
}

// rowGridWalker accumulates one <table>'s rows into a naive grid,
// carrying rowspans across TR boundaries via its own carry map --
// split out of htmlTableRows (one function per concern: fill, cell,
// row) to keep each piece's own cognitive complexity low, gocognit @
// 15 (.claude/rules/testing.md's quality gate).
type rowGridWalker struct {
	rowSpans map[int]rowSpanCarry
	rows     [][]string
}

// fillCarried appends any carried rowspan values sitting at col
// onward into row, advancing col past them.
func (w *rowGridWalker) fillCarried(row []string, col int) ([]string, int) {
	for {
		c, ok := w.rowSpans[col]
		if !ok || c.remaining == 0 {
			return row, col
		}
		row = append(row, c.text)
		c.remaining--
		if c.remaining == 0 {
			delete(w.rowSpans, col)
		} else {
			w.rowSpans[col] = c
		}
		col++
	}
}

// addCell appends one <th>/<td>'s own text into row (repeated
// colspan-many times), registers a carry for any rowspan > 1, and
// fills whatever the advance uncovers.
func (w *rowGridWalker) addCell(row []string, col int, cell *goquery.Selection) ([]string, int) {
	text := strings.TrimSpace(cell.Text())
	colspan := attrInt(cell, "colspan", 1)
	rowspan := attrInt(cell, "rowspan", 1)
	for i := 0; i < colspan; i++ {
		row = append(row, text)
		if rowspan > 1 {
			w.rowSpans[col] = rowSpanCarry{text: text, remaining: rowspan - 1}
		}
		col++
		row, col = w.fillCarried(row, col)
	}
	return row, col
}

// addRow walks one <tr>'s own cells (its own carried rowspans filled
// first) and appends the finished row.
func (w *rowGridWalker) addRow(tr *goquery.Selection) {
	row, col := w.fillCarried(nil, 0)
	tr.ChildrenFiltered("th, td").Each(func(_ int, cell *goquery.Selection) {
		row, col = w.addCell(row, col, cell)
	})
	w.rows = append(w.rows, row)
}

// htmlTableRows walks a <table>'s own rows into a naive grid: colspan
// repeats a cell's text across its span; rowspan carries a cell's text
// down into the same column for the rows beneath it. This is a
// flatten, not a merge -- a rowspan that lands under a LATER
// differently-shaped colspan run in the same column can misalign by a
// column; v1 accepts that rare case rather than building a full grid
// solver.
func htmlTableRows(table *goquery.Selection) [][]string {
	w := &rowGridWalker{rowSpans: map[int]rowSpanCarry{}}
	tableRowSelection(table).Each(func(_ int, tr *goquery.Selection) {
		w.addRow(tr)
	})
	return w.rows
}

func attrInt(sel *goquery.Selection, name string, def int) int {
	v, exists := sel.Attr(name)
	if !exists {
		return def
	}
	n, err := strconv.Atoi(strings.TrimSpace(v))
	if err != nil || n < 1 {
		return def
	}
	return n
}
