package drawio

import (
	"strings"
	"testing"
)

const twoPageInline = `<?xml version="1.0" encoding="UTF-8"?>` +
	`<mxfile host="app.diagrams.net" agent="test" version="22.1.2">` +
	`<diagram id="pg1" name="Runtime"><mxGraphModel dx="800" dy="600" grid="1" gridSize="10">` +
	`<root><mxCell id="0"/><mxCell id="1" parent="0"/>` +
	`<mxCell id="a" value="Start" style="rounded=0;" vertex="1" parent="1"><mxGeometry x="10" y="20" width="120" height="60" as="geometry"/></mxCell>` +
	`<mxCell id="b" value="End" style="rounded=0;" vertex="1" parent="1"><mxGeometry x="240" y="20" width="120" height="60" as="geometry"/></mxCell>` +
	`<mxCell id="ab" value="calls" edge="1" parent="1" source="a" target="b"><mxGeometry relative="1" as="geometry"/></mxCell>` +
	`</root></mxGraphModel></diagram>` +
	`<diagram id="pg2" name="Untouched"><mxGraphModel dx="1" dy="2"><root><mxCell id="0"/><mxCell id="1" parent="0"/>` +
	`<mxCell id="z" value="Keep" vertex="1" parent="1"><mxGeometry x="1" y="1" width="2" height="3" as="geometry"/></mxCell>` +
	`</root></mxGraphModel></diagram></mxfile>`

func TestParseDocument_UntouchedFileRoundTripsByteIdentical(t *testing.T) {
	d, err := ParseDocument(twoPageInline)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	out, err := d.Marshal()
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if out != twoPageInline {
		t.Errorf("round trip changed the file:\n got %s\nwant %s", out, twoPageInline)
	}
}

func TestEditCells_LeavesTheOtherPageByteIdentical(t *testing.T) {
	d, err := ParseDocument(twoPageInline)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	p, err := d.Page("pg1")
	if err != nil {
		t.Fatalf("page: %v", err)
	}
	if _, err := EditCells(p, []CellPatch{{ID: "a", Label: "Renamed", Geometry: &GeometryOut{X: ptr(99)}}}); err != nil {
		t.Fatalf("edit: %v", err)
	}
	out, err := d.Marshal()
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if !strings.Contains(out, `<diagram id="pg2" name="Untouched"><mxGraphModel dx="1" dy="2"><root><mxCell id="0"></mxCell>`) &&
		!strings.Contains(out, `<diagram id="pg2" name="Untouched"><mxGraphModel dx="1" dy="2"><root><mxCell id="0"/>`) {
		t.Errorf("the untouched page was rewritten: %s", out)
	}
	if !strings.Contains(out, `value="Renamed"`) || !strings.Contains(out, `x="99"`) {
		t.Errorf("the edit did not land: %s", out)
	}
	// Only the named coordinate changes; y/width/height stay.
	if !strings.Contains(out, `y="20"`) || !strings.Contains(out, `width="120"`) {
		t.Errorf("geometry merge replaced unnamed coordinates: %s", out)
	}
	// The page's own model attributes survive.
	if !strings.Contains(out, `<mxGraphModel dx="800" dy="600" grid="1" gridSize="10">`) {
		t.Errorf("the edited page lost its model attributes: %s", out)
	}
	// A cell nobody named keeps its exact style and geometry.
	if !strings.Contains(out, `id="b" value="End" style="rounded=0;" vertex="1" parent="1"`) {
		t.Errorf("an untouched cell was rewritten: %s", out)
	}
}

func TestCompressedPageStaysCompressed(t *testing.T) {
	model := `<mxGraphModel dx="5"><root><mxCell id="0"/><mxCell id="1" parent="0"/>` +
		`<mxCell id="v" value="Zip" vertex="1" parent="1"><mxGeometry x="0" y="0" width="10" height="10" as="geometry"/></mxCell></root></mxGraphModel>`
	payload, err := deflateWireText(model)
	if err != nil {
		t.Fatalf("deflate: %v", err)
	}
	src := `<mxfile host="app.diagrams.net"><diagram id="c1" name="Compressed">` + payload + `</diagram></mxfile>`
	d, err := ParseDocument(src)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	p, _ := d.Page("c1")
	if p.Form() != WireCompressed {
		t.Fatalf("form = %q, want %q", p.Form(), WireCompressed)
	}
	if _, err := AddCells(p, []CellSpec{{Kind: KindVertex, Label: "Added"}}); err != nil {
		t.Fatalf("add: %v", err)
	}
	out, err := d.Marshal()
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if strings.Contains(out, "<mxGraphModel") {
		t.Fatalf("a compressed page was rewritten as plain XML: %s", out)
	}
	// It still decodes, and carries both cells.
	again, err := ParseDocument(out)
	if err != nil {
		t.Fatalf("reparse: %v", err)
	}
	rp, _ := again.Page("c1")
	if rp.Form() != WireCompressed {
		t.Fatalf("reparsed form = %q", rp.Form())
	}
	_, cells, err := ReadPage(rp)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if len(cells) != 2 {
		t.Fatalf("cells = %d, want 2 (%v)", len(cells), cells)
	}
}
