package drawio

import (
	"strings"
	"testing"
)

// The fixture the e2e suite already drives a real diagram board object
// with (frontend/e2e/fixtures/diagram-pick.drawio's sibling shape):
// two vertices joined by an edge, draw.io's own default layer cells
// present.
const samplePage = `<mxfile host="mill"><diagram id="p" name="Page-1"><mxGraphModel>` +
	`<root><mxCell id="0"/><mxCell id="1" parent="0"/>` +
	`<mxCell id="2" value="Start" style="rounded=0;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="120" y="120" width="120" height="60" as="geometry"/></mxCell>` +
	`<mxCell id="3" value="End" style="rounded=0;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="320" y="120" width="120" height="60" as="geometry"/></mxCell>` +
	`<mxCell id="4" style="edgeStyle=orthogonalEdgeStyle;html=1;" edge="1" parent="1" source="2" target="3"><mxGeometry relative="1" as="geometry"/></mxCell>` +
	`</root></mxGraphModel></diagram></mxfile>`

func samplePageDoc(t *testing.T) (*Document, *Page) {
	t.Helper()
	d, err := ParseDocument(samplePage)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	p, err := d.Page("")
	if err != nil {
		t.Fatalf("page: %v", err)
	}
	return d, p
}

func TestReadPage_ReportsLayersAndCellsWithIDs(t *testing.T) {
	_, p := samplePageDoc(t)
	layers, cells, err := ReadPage(p)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if len(layers) != 1 || layers[0].ID != "1" || !layers[0].Visible {
		t.Errorf("layers = %+v, want the one visible default layer", layers)
	}
	if len(cells) != 3 {
		t.Fatalf("cells = %d, want 3", len(cells))
	}
	if cells[0].ID != "2" || cells[0].Kind != KindVertex || cells[0].Label != "Start" {
		t.Errorf("first cell = %+v", cells[0])
	}
	if cells[0].Geometry == nil || *cells[0].Geometry.X != 120 || *cells[0].Geometry.W != 120 {
		t.Errorf("geometry = %+v", cells[0].Geometry)
	}
	if cells[2].Kind != KindEdge || cells[2].Source != "2" || cells[2].Target != "3" {
		t.Errorf("edge cell = %+v", cells[2])
	}
}

func TestReadPage_DecodesHTMLEntitiesInLabels(t *testing.T) {
	d, err := ParseDocument(`<mxfile><diagram name="p"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>` +
		`<mxCell id="v" value="Order &amp;amp; pay&amp;nbsp;now" vertex="1" parent="1"/></root></mxGraphModel></diagram></mxfile>`)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	p, _ := d.Page("")
	_, cells, err := ReadPage(p)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if cells[0].Label != "Order & pay now" {
		t.Errorf("label = %q", cells[0].Label)
	}
}

func TestAddCells_MintsIDsHonoursClientIDsAndDefaults(t *testing.T) {
	_, p := samplePageDoc(t)
	ids, err := AddCells(p, []CellSpec{
		{Kind: KindVertex, Label: "Minted"},
		{ID: "mine", Kind: KindVertex, Label: "Mine", Geometry: &GeometryOut{X: ptr(500)}},
		{Kind: KindEdge, Label: "joins", Source: "2", Target: "mine"},
	})
	if err != nil {
		t.Fatalf("add: %v", err)
	}
	if len(ids) != 3 || !strings.HasPrefix(ids[0], "mill-") || len(ids[0]) != len("mill-")+8 || ids[1] != "mine" {
		t.Fatalf("ids = %v", ids)
	}
	_, cells, err := ReadPage(p)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	byID := map[string]CellOut{}
	for _, c := range cells {
		byID[c.ID] = c
	}
	minted := byID[ids[0]]
	if minted.Parent != RootLayerID || minted.Style != DefaultVertexStyle {
		t.Errorf("minted defaults = %+v", minted)
	}
	if *minted.Geometry.X != defaultVertexX || *minted.Geometry.W != defaultVertexWidth || *minted.Geometry.H != defaultVertexHeight {
		t.Errorf("default geometry = %+v", minted.Geometry)
	}
	if *byID["mine"].Geometry.X != 500 || *byID["mine"].Geometry.Y != defaultVertexY {
		t.Errorf("partial geometry = %+v", byID["mine"].Geometry)
	}
	if byID[ids[2]].Kind != KindEdge || byID[ids[2]].Target != "mine" {
		t.Errorf("edge = %+v", byID[ids[2]])
	}
}

func TestAddCells_Errors(t *testing.T) {
	cases := []struct {
		name  string
		specs []CellSpec
		want  string
	}{
		{"id collision", []CellSpec{{ID: "2", Kind: KindVertex}}, `id "2" is already on this page`},
		{"edge without endpoints", []CellSpec{{Kind: KindEdge, Source: "2"}}, "target is missing"},
		{"edge to a missing cell", []CellSpec{{Kind: KindEdge, Source: "2", Target: "nope"}}, `no cell with id "nope"`},
		{"unknown kind", []CellSpec{{Kind: "blob"}}, `not "blob"`},
		{"nothing to add", nil, "at least one cell"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			d, p := samplePageDoc(t)
			before, _ := d.Marshal()
			_, err := AddCells(p, tc.specs)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("err = %v, want one naming %q", err, tc.want)
			}
			after, _ := d.Marshal()
			if after != before {
				t.Errorf("a rejected add still wrote to the file")
			}
		})
	}
}

func TestEditCells_UnknownIDWritesNothing(t *testing.T) {
	d, p := samplePageDoc(t)
	before, _ := d.Marshal()
	if _, err := EditCells(p, []CellPatch{{ID: "2", Label: "ok"}, {ID: "ghost", Label: "no"}}); err == nil ||
		!strings.Contains(err.Error(), `no cell with id "ghost"`) {
		t.Fatalf("err = %v", err)
	}
	after, _ := d.Marshal()
	if after != before {
		t.Errorf("a rejected batch applied its first patch anyway")
	}
}

func TestDeleteCells_RemovesDanglingEdgesAndProtectsStructure(t *testing.T) {
	_, p := samplePageDoc(t)
	deleted, edges, err := DeleteCells(p, []string{"3"})
	if err != nil {
		t.Fatalf("delete: %v", err)
	}
	if len(deleted) != 1 || deleted[0] != "3" || len(edges) != 1 || edges[0] != "4" {
		t.Fatalf("deleted=%v edgesRemoved=%v", deleted, edges)
	}
	_, cells, _ := ReadPage(p)
	if len(cells) != 1 || cells[0].ID != "2" {
		t.Errorf("cells after delete = %+v", cells)
	}
}

func TestDeleteCells_Errors(t *testing.T) {
	for _, tc := range []struct{ id, want string }{
		{"0", "cannot be deleted"},
		{"1", "cannot be deleted"},
		{"ghost", `no cell with id "ghost"`},
	} {
		t.Run(tc.id, func(t *testing.T) {
			d, p := samplePageDoc(t)
			before, _ := d.Marshal()
			if _, _, err := DeleteCells(p, []string{tc.id}); err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("err = %v, want one naming %q", err, tc.want)
			}
			if after, _ := d.Marshal(); after != before {
				t.Errorf("a rejected delete still wrote to the file")
			}
		})
	}
}

func TestEditCells_KeepsALabelWrapperObjectIntact(t *testing.T) {
	d, err := ParseDocument(`<mxfile><diagram name="p"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>` +
		`<object label="Rich" custom="keep" id="o1"><mxCell style="s=1;" vertex="1" parent="1">` +
		`<mxGeometry x="1" y="2" width="3" height="4" as="geometry"/></mxCell></object></root></mxGraphModel></diagram></mxfile>`)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	p, _ := d.Page("")
	if _, err := EditCells(p, []CellPatch{{ID: "o1", Label: "Renamed", Geometry: &GeometryOut{Y: ptr(50)}}}); err != nil {
		t.Fatalf("edit: %v", err)
	}
	out, _ := d.Marshal()
	if !strings.Contains(out, `custom="keep"`) || !strings.Contains(out, `label="Renamed"`) ||
		!strings.Contains(out, `y="50"`) || !strings.Contains(out, `x="1"`) || !strings.Contains(out, `style="s=1;"`) {
		t.Errorf("wrapper edit lost fidelity: %s", out)
	}
}
