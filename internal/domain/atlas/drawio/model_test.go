package drawio

import (
	"net/url"
	"strings"
	"testing"
)

// The decode ladder's own tests, at the ladder's home. atlassvc's paste
// suite drives the same three wire forms through its alias, but Go
// records coverage per package under test, so the ladder needs its own
// proof here or it reads as dead code.

// firstPage is this file's own accessor -- Document.Page("") with the
// error folded away, since every caller below has already parsed
// successfully.
func firstPage(d *Document) *Page {
	p, _ := d.Page("")
	return p
}

const ladderModelXML = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>` +
	`<mxCell id="2" value="Vendor API" vertex="1" parent="1"><mxGeometry x="40" y="40" width="120" height="60"/></mxCell>` +
	`<mxCell id="3" value="Store" vertex="1" parent="1"><mxGeometry x="240" y="40" width="120" height="60"/></mxCell>` +
	`<mxCell id="4" value="calls" edge="1" parent="1" source="2" target="3"/></root></mxGraphModel>`

func TestDecodeDiagramText_EveryWireForm(t *testing.T) {
	compressed, err := deflateWireText(ladderModelXML)
	if err != nil {
		t.Fatalf("deflate: %v", err)
	}
	for name, text := range map[string]string{
		"raw":        ladderModelXML,
		"uri":        url.PathEscape(ladderModelXML),
		"compressed": compressed,
		"declared":   `<?xml version="1.0" encoding="UTF-8"?>` + ladderModelXML,
	} {
		t.Run(name, func(t *testing.T) {
			m, skipped, ok := DecodeDiagramText(text)
			if !ok || len(skipped) != 0 {
				t.Fatalf("ok=%v skipped=%v", ok, skipped)
			}
			if len(m.Cells) != 5 || m.Cells[2].Value != "Vendor API" || m.Cells[4].Source != "2" {
				t.Errorf("cells = %+v", m.Cells)
			}
		})
	}
}

func TestDecodeDiagramText_MultiPageMergesWithPerPagePrefixes(t *testing.T) {
	src := `<mxfile><diagram name="One">` + ladderModelXML + `</diagram>` +
		`<diagram name="Two">` + ladderModelXML + `</diagram></mxfile>`
	m, skipped, ok := DecodeDiagramText(src)
	if !ok || len(skipped) != 0 {
		t.Fatalf("ok=%v skipped=%v", ok, skipped)
	}
	if len(m.Cells) != 10 {
		t.Fatalf("cells = %d, want both pages merged", len(m.Cells))
	}
	if m.Cells[2].ID != "p0:2" || m.Cells[7].ID != "p1:2" || m.Cells[9].Source != "p1:2" {
		t.Errorf("page prefixes not applied: %q %q %q", m.Cells[2].ID, m.Cells[7].ID, m.Cells[9].Source)
	}
}

func TestDecodeDiagramText_NamesAPageItCouldNotDecode(t *testing.T) {
	src := `<mxfile><diagram name="Good">` + ladderModelXML + `</diagram>` +
		`<diagram name="Broken">not a diagram at all</diagram></mxfile>`
	m, skipped, ok := DecodeDiagramText(src)
	if !ok {
		t.Fatal("a file naming pages must be recognized even when one page fails")
	}
	if len(skipped) != 1 || skipped[0] != "Broken" {
		t.Errorf("skipped = %v", skipped)
	}
	if len(m.Cells) != 5 {
		t.Errorf("the good page's cells = %d", len(m.Cells))
	}
	if got := PageName("", 3); got != "Page 4" {
		t.Errorf("PageName fallback = %q", got)
	}
}

func TestDecodeDiagramText_RejectsWhatIsNotADiagram(t *testing.T) {
	for _, text := range []string{"", "   ", "just some prose about <tables>", "<html><body>hi</body></html>", "!!!!not base64!!!!"} {
		if _, _, ok := DecodeDiagramText(text); ok {
			t.Errorf("DecodeDiagramText(%q) claimed to be a diagram", text)
		}
	}
}

func TestParseDocument_BareModelAndURIPageRewrite(t *testing.T) {
	bare, err := ParseDocument(ladderModelXML)
	if err != nil {
		t.Fatalf("parse bare model: %v", err)
	}
	if len(PagesOf(bare)) != 1 || PagesOf(bare)[0].Name != "Page 1" {
		t.Errorf("pages = %+v", PagesOf(bare))
	}
	if _, err := AddCells(firstPage(bare), []CellSpec{{Kind: KindVertex, Label: "Appended"}}); err != nil {
		t.Fatalf("add: %v", err)
	}
	out, err := bare.Marshal()
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if !strings.HasPrefix(out, "<mxGraphModel") || !strings.Contains(out, `value="Appended"`) {
		t.Errorf("bare-model marshal = %.120q", out)
	}

	uriSrc := `<mxfile><diagram id="u" name="Encoded">` + uriEncode(ladderModelXML) + `</diagram></mxfile>`
	doc, err := ParseDocument(uriSrc)
	if err != nil {
		t.Fatalf("parse uri page: %v", err)
	}
	page, _ := doc.Page("Encoded")
	if page.Form() != WireURI {
		t.Fatalf("form = %q", page.Form())
	}
	if _, err := EditCells(page, []CellPatch{{ID: "2", Label: "Renamed"}}); err != nil {
		t.Fatalf("edit: %v", err)
	}
	rewritten, err := doc.Marshal()
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if strings.Contains(rewritten, "<mxGraphModel") {
		t.Fatalf("a URI-encoded page was rewritten as plain XML: %s", rewritten)
	}
	again, err := ParseDocument(rewritten)
	if err != nil {
		t.Fatalf("reparse: %v", err)
	}
	back, _ := again.Page("u")
	if back.Form() != WireURI {
		t.Errorf("reparsed form = %q", back.Form())
	}
	_, cells, err := ReadPage(back)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if cells[0].Label != "Renamed" {
		t.Errorf("cells = %+v", cells)
	}
}

func TestAddCells_SeedsTheMandatoryLayerIntoAnEmptyPage(t *testing.T) {
	d, err := ParseDocument(`<mxfile><diagram id="e" name="Empty"></diagram></mxfile>`)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	page, _ := d.Page("")
	ids, err := AddCells(page, []CellSpec{{Kind: KindVertex, Label: "First"}})
	if err != nil {
		t.Fatalf("add: %v", err)
	}
	layers, cells, err := ReadPage(page)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if len(layers) != 1 || layers[0].ID != RootLayerID {
		t.Errorf("layers = %+v", layers)
	}
	if len(cells) != 1 || cells[0].ID != ids[0] || cells[0].Parent != RootLayerID {
		t.Errorf("cells = %+v", cells)
	}
}

func TestParseDocument_RejectsWhatIsNotADocument(t *testing.T) {
	for _, src := range []string{"", "hello", "<mxfile></mxfile>", "<mxfile><diagram"} {
		if _, err := ParseDocument(src); err == nil {
			t.Errorf("ParseDocument(%q) accepted a non-document", src)
		}
	}
}

func TestPageLookupAndOpaquePages(t *testing.T) {
	d, err := ParseDocument(`<mxfile><diagram id="o" name="Opaque">%%%not decodable%%%</diagram></mxfile>`)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	page, _ := d.Page("")
	if page.Form() != WireOpaque {
		t.Fatalf("form = %q", page.Form())
	}
	// An untouched opaque page still round-trips verbatim.
	if out, err := d.Marshal(); err != nil || !strings.Contains(out, "%%%not decodable%%%") {
		t.Fatalf("marshal = %q, err = %v", out, err)
	}
	// Rewriting one is refused rather than silently corrupting it.
	page.SetModelXML("<mxGraphModel><root/></mxGraphModel>")
	if _, err := d.Marshal(); err == nil || !strings.Contains(err.Error(), "cannot rewrite") {
		t.Errorf("marshal err = %v", err)
	}
	if _, err := d.Page("nope"); err == nil || !strings.Contains(err.Error(), "no page with id or name") {
		t.Errorf("Page err = %v", err)
	}
}
