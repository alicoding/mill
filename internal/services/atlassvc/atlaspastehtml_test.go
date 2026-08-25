package atlassvc

import (
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/domain/typedfield"
)

// Real-shaped M365 clipboard fixtures (docs/goals/0218's own corpus
// requirement): each mirrors what that app's actual text/html
// clipboard flavor carries for a copied table, not a hand-simplified
// stand-in -- mso- classes/styles and Word's own conditional-comment
// VML block, Teams/Outlook's nested div/span-per-cell wrapping, and
// Excel's xl-class/colgroup shape.

const wordTableHTML = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset=utf-8>
<style>
<!--
 @font-face
	{font-family:"Cambria Math";
	panose-1:2 4 5 3 5 4 6 3 2 4;}
p.MsoNormal, li.MsoNormal, div.MsoNormal
	{margin:0in;
	font-size:11.0pt;
	font-family:"Calibri",sans-serif;}
-->
</style>
</head>
<body lang=EN-US style='word-wrap:break-word'>
<!--[if gte mso 9]><xml>
<o:shapedefaults v:ext="edit" spidmax="1026"/>
</xml><![endif]-->
<!--StartFragment-->
<table class=MsoTableGrid border=1 cellspacing=0 cellpadding=0 style='border-collapse:collapse;border:none'>
 <tr>
  <td width=185 valign=top style='width:138.75pt;border:solid windowtext 1.0pt;padding:0in 5.4pt 0in 5.4pt'>
  <p class=MsoNormal>Vendor<o:p></o:p></p>
  </td>
  <td width=185 valign=top style='width:138.75pt;border:solid windowtext 1.0pt;padding:0in 5.4pt 0in 5.4pt'>
  <p class=MsoNormal>Status<o:p></o:p></p>
  </td>
 </tr>
 <tr>
  <td width=185 valign=top style='width:138.75pt;border:solid windowtext 1.0pt;padding:0in 5.4pt 0in 5.4pt'>
  <p class=MsoNormal>Acme Corp<o:p></o:p></p>
  </td>
  <td width=185 valign=top style='width:138.75pt;border:solid windowtext 1.0pt;padding:0in 5.4pt 0in 5.4pt'>
  <p class=MsoNormal>Healthy<o:p></o:p></p>
  </td>
 </tr>
</table>
<!--EndFragment-->
</body>
</html>`

const teamsOutlookTableHTML = `<div>
<table style="border-collapse:collapse">
<tbody>
<tr>
<td style="border:1px solid #ccc;padding:4px"><div><span style="font-weight:600">Name</span></div></td>
<td style="border:1px solid #ccc;padding:4px"><div><span style="font-weight:600">Owner</span></div></td>
</tr>
<tr>
<td style="border:1px solid #ccc;padding:4px"><div><span>Runtime alert</span></div></td>
<td style="border:1px solid #ccc;padding:4px"><div><span>SRE on-call</span></div></td>
</tr>
</tbody>
</table>
</div>`

const excelTableHTML = `<html xmlns:x="urn:schemas-microsoft-com:office:excel">
<head>
<style>
.xl65 {mso-number-format:"General";}
</style>
</head>
<body link="blue" vlink="purple">
<table border=0 cellpadding=0 cellspacing=0 width=200 style='border-collapse:collapse;width:150pt'>
 <colgroup><col width=100><col width=100></colgroup>
 <tr height=20>
  <td class=xl65 height=20 width=100>Region</td>
  <td class=xl65 width=100>Revenue</td>
 </tr>
 <tr height=20>
  <td class=xl65>EMEA</td>
  <td class=xl65>42000</td>
 </tr>
</table>
</body>
</html>`

const plainProseHTML = `<html><body><p>Meeting notes: follow up with the vendor about the Q3 renewal before check-in on Thursday.</p></body></html>`

var tableInLongDocumentHTML = `<html><body>` +
	`<p>` + strings.Repeat("This paragraph exists purely to push the surrounding prose well past the two hundred character recognition threshold so the payload reads as a document instead of a table paste. ", 2) + `</p>` +
	`<table><tr><td>Name</td><td>Status</td></tr><tr><td>Acme</td><td>Healthy</td></tr></table>` +
	`<p>More narrative text follows the table to describe what it means in context.</p>` +
	`</body></html>`

const rowspanColspanHTML = `<table>
<tr><th colspan="2">Region</th><th>Status</th></tr>
<tr><td rowspan="2">EMEA</td><td>UK</td><td>Healthy</td></tr>
<tr><td>DE</td><td>Blocked</td></tr>
</table>`

const multiTableHTML = `<table><tr><td>Name</td><td>Status</td></tr><tr><td>Acme</td><td>Healthy</td></tr></table>` +
	`<table><tr><td>Region</td><td>Revenue</td></tr><tr><td>EMEA</td><td>42000</td></tr></table>`

// detectHTMLTables must recognize every real M365 shape and pull the
// same two-column, two-row grid out of each -- mso- styling, VML
// comments, and nested div/span wrapping are all noise goquery's own
// Text() already strips.
func TestDetectHTMLTables_M365Fixtures(t *testing.T) {
	cases := []struct {
		name string
		html string
		rows [][]string
	}{
		{"word", wordTableHTML, [][]string{{"Vendor", "Status"}, {"Acme Corp", "Healthy"}}},
		{"teams-outlook", teamsOutlookTableHTML, [][]string{{"Name", "Owner"}, {"Runtime alert", "SRE on-call"}}},
		{"excel", excelTableHTML, [][]string{{"Region", "Revenue"}, {"EMEA", "42000"}}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			tables, ok := detectHTMLTables(c.html)
			if !ok {
				t.Fatalf("detectHTMLTables(%s) = not recognized, want recognized", c.name)
			}
			if len(tables) != 1 {
				t.Fatalf("tables = %+v, want exactly 1", tables)
			}
			if len(tables[0].Rows) != len(c.rows) {
				t.Fatalf("rows = %+v, want %+v", tables[0].Rows, c.rows)
			}
			for i, wantRow := range c.rows {
				gotRow := tables[0].Rows[i]
				if len(gotRow) != len(wantRow) {
					t.Fatalf("row %d = %+v, want %+v", i, gotRow, wantRow)
				}
				for j, want := range wantRow {
					if gotRow[j] != want {
						t.Errorf("row %d col %d = %q, want %q", i, j, gotRow[j], want)
					}
				}
			}
		})
	}
}

// A table buried in substantial prose is a document, not a table paste
// -- the popover/note fallback owns it. Plain prose with no table at
// all is the same "not recognized" outcome for a different reason.
func TestDetectHTMLTables_NotRecognized(t *testing.T) {
	cases := []struct {
		name string
		html string
	}{
		{"table in long document", tableInLongDocumentHTML},
		{"plain prose, no table", plainProseHTML},
		{"empty", ""},
		{"whitespace only", "   \n\t  "},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if _, ok := detectHTMLTables(c.html); ok {
				t.Errorf("detectHTMLTables(%s) = recognized, want NOT recognized", c.name)
			}
		})
	}
}

// Rowspan/colspan flatten naively (docs/goals/0218's stated v1 limit):
// colspan repeats the cell's text across the columns it spans; rowspan
// carries the cell's text down into the same column for the rows
// beneath it.
func TestDetectHTMLTables_RowspanColspanFlattenedNaively(t *testing.T) {
	tables, ok := detectHTMLTables(rowspanColspanHTML)
	if !ok || len(tables) != 1 {
		t.Fatalf("detectHTMLTables = %+v, ok=%v, want one recognized table", tables, ok)
	}
	want := [][]string{
		{"Region", "Region", "Status"},
		{"EMEA", "UK", "Healthy"},
		{"EMEA", "DE", "Blocked"},
	}
	got := tables[0].Rows
	if len(got) != len(want) {
		t.Fatalf("rows = %+v, want %+v", got, want)
	}
	for i := range want {
		if len(got[i]) != len(want[i]) {
			t.Fatalf("row %d = %+v, want %+v", i, got[i], want[i])
		}
		for j := range want[i] {
			if got[i][j] != want[i][j] {
				t.Errorf("row %d col %d = %q, want %q", i, j, got[i][j], want[i][j])
			}
		}
	}
}

// Multiple tables in one payload each become their own pastedTable,
// numbered since neither carries a <caption> -- the multi-page drawio
// precedent applied to HTML.
func TestDetectHTMLTables_MultipleTablesEachOwnEntry(t *testing.T) {
	tables, ok := detectHTMLTables(multiTableHTML)
	if !ok || len(tables) != 2 {
		t.Fatalf("detectHTMLTables = %+v, ok=%v, want 2 recognized tables", tables, ok)
	}
	if tables[0].Label != "Pasted table 1" || tables[1].Label != "Pasted table 2" {
		t.Errorf("labels = %q, %q, want numbered", tables[0].Label, tables[1].Label)
	}
}

// PasteToBoard's own HTML-table recognizer entry: an M365 table lands
// exactly one board object through the SAME List-minting path TSV/
// drawio tables use -- never a card.
func TestPasteToBoard_HTMLTableBecomesBoardObject(t *testing.T) {
	a := newTestAtlasService(t)
	wireFakeProjection(a)
	cardsBefore := len(a.Cards())
	var gotFields []typedfield.Field
	var gotRows []map[string]string
	a.WirePasteListWrites(
		func(label string, columns []typedfield.Field) (string, error) {
			gotFields = columns
			return "list-vendors", nil
		},
		func(listID string, values map[string]string) error {
			gotRows = append(gotRows, values)
			return nil
		},
	)
	// The tab-less plain-text sibling M365 apps carry alongside their
	// HTML flavor (docs/goals/0218's own root-cause trace) -- proves the
	// HTML recognizer wins even though this text has no tabs to trip
	// TSV, and would never recognize on its own.
	res, err := a.PasteToBoard("Vendor\tStatus", wordTableHTML, "", 0, 0)
	if err != nil {
		t.Fatalf("PasteToBoard: %v", err)
	}
	if !res.Recognized || res.Tables != 1 || res.Cards != 0 {
		t.Fatalf("result = %+v, want one table, no cards", res)
	}
	if len(gotFields) != 2 || gotFields[0].Key != "vendor" || gotFields[1].Key != "status" {
		t.Errorf("fields = %+v, want slugged vendor/status", gotFields)
	}
	if len(gotRows) != 1 || gotRows[0]["vendor"] != "Acme Corp" || gotRows[0]["status"] != "Healthy" {
		t.Errorf("rows = %+v, want the one data row", gotRows)
	}
	if len(a.Cards()) != cardsBefore {
		t.Errorf("expected no card to be created, got %d (was %d)", len(a.Cards()), cardsBefore)
	}
}

// The recognizer chain is ordered (docs/goals/0218 acceptance): a
// drawio-shaped text payload wins even when the accompanying HTML also
// carries a table, and an HTML table wins over a same-payload TSV-
// shaped text sibling -- proving the chain tries drawio, then HTML,
// then TSV, in that fixed order, never re-deciding per payload shape.
func TestPasteToBoard_RecognizerChainOrder(t *testing.T) {
	a := newTestAtlasService(t)
	res, err := a.PasteToBoard(pasteDiagramXML, wordTableHTML, "", 0, 0)
	if err != nil {
		t.Fatalf("PasteToBoard: %v", err)
	}
	if res.Cards != 2 || res.Links != 1 || res.Tables != 0 {
		t.Fatalf("result = %+v, want the drawio recognizer to win (2 cards, 1 link, no table)", res)
	}

	b := newTestAtlasService(t)
	wireFakeProjection(b)
	var gotRows []map[string]string
	b.WirePasteListWrites(
		func(label string, columns []typedfield.Field) (string, error) { return "list-vendors", nil },
		func(listID string, values map[string]string) error {
			gotRows = append(gotRows, values)
			return nil
		},
	)
	// text is independently TSV-shaped ("Vendor\tStatus\nAcme\tHealthy")
	// and would recognize on its own via recognizeTSVPaste; html
	// independently carries a table via wordTableHTML. Both could
	// legitimately produce a table here, so the row VALUE is the only
	// way to tell which recognizer actually fired: the HTML fixture's
	// own data row reads "Acme Corp", never plain TSV's "Acme".
	res2, err := b.PasteToBoard("Vendor\tStatus\nAcme\tHealthy", wordTableHTML, "", 0, 0)
	if err != nil {
		t.Fatalf("PasteToBoard: %v", err)
	}
	if res2.Cards != 0 || res2.Tables != 1 {
		t.Fatalf("result = %+v, want exactly one table, no cards", res2)
	}
	if len(gotRows) != 1 || gotRows[0]["vendor"] != "Acme Corp" {
		t.Fatalf("rows = %+v, want the HTML table's own row (\"Acme Corp\"), proving the HTML recognizer won over TSV", gotRows)
	}
}
