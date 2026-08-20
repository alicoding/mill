package atlassvc

import (
	"bytes"
	"compress/flate"
	"encoding/base64"
	"net/url"
	"testing"

	"github.com/alicoding/mill/internal/domain/typedfield"
)

const pasteDiagramXML = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>` +
	`<mxCell id="2" value="Vendor API" vertex="1" parent="1"><mxGeometry x="40" y="40" width="120" height="60"/></mxCell>` +
	`<mxCell id="3" value="" vertex="1" parent="1"><mxGeometry x="240" y="40" width="120" height="60"/></mxCell>` +
	`<mxCell id="4" value="calls" edge="1" parent="1" source="2" target="3"/></root></mxGraphModel>`

const pasteTableXML = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>` +
	`<mxCell id="t" value="Vendors" style="shape=table;html=1" vertex="1" parent="1"><mxGeometry x="0" y="0" width="200" height="90"/></mxCell>` +
	`<mxCell id="r1" style="shape=tableRow;html=1" vertex="1" parent="t"><mxGeometry y="0" width="200" height="30"/></mxCell>` +
	`<mxCell id="c11" value="Name" vertex="1" parent="r1"><mxGeometry x="0" width="100" height="30"/></mxCell>` +
	`<mxCell id="c12" value="Status" vertex="1" parent="r1"><mxGeometry x="100" width="100" height="30"/></mxCell>` +
	`<mxCell id="r2" style="shape=tableRow;html=1" vertex="1" parent="t"><mxGeometry y="30" width="200" height="30"/></mxCell>` +
	`<mxCell id="c21" value="Acme" vertex="1" parent="r2"><mxGeometry x="0" width="100" height="30"/></mxCell>` +
	`<mxCell id="c22" value="Healthy" vertex="1" parent="r2"><mxGeometry x="100" width="100" height="30"/></mxCell>` +
	`</root></mxGraphModel>`

// The decode ladder accepts all three wire forms of the same model.
func TestDecodeDiagramText_AllWireForms(t *testing.T) {
	if _, ok := decodeDiagramText(pasteDiagramXML); !ok {
		t.Fatal("raw XML must decode")
	}
	if _, ok := decodeDiagramText(url.PathEscape(pasteDiagramXML)); !ok {
		t.Fatal("URI-encoded must decode")
	}
	var buf bytes.Buffer
	w, _ := flate.NewWriter(&buf, flate.DefaultCompression)
	// encodeURIComponent never emits '+' -- PathEscape mirrors it.
	_, _ = w.Write([]byte(url.PathEscape(pasteDiagramXML)))
	_ = w.Close()
	if _, ok := decodeDiagramText(base64.StdEncoding.EncodeToString(buf.Bytes())); !ok {
		t.Fatal("base64+deflate must decode")
	}
	if _, ok := decodeDiagramText("just some prose about <tables>"); ok {
		t.Fatal("ordinary text must NOT decode")
	}
}

// A diagram-shaped paste lands cards for vertices (empty label ->
// Untitled) and links for edges, positions offset to the paste point.
func TestPasteToBoard_DiagramBecomesCardsAndLinks(t *testing.T) {
	a := newTestAtlasService(t)
	res, err := a.PasteToBoard(pasteDiagramXML, "", 100, 200)
	if err != nil {
		t.Fatalf("PasteToBoard: %v", err)
	}
	if !res.Recognized || res.Cards != 2 || res.Links != 1 || res.Tables != 0 {
		t.Fatalf("result = %+v, want recognized 2 cards 1 link", res)
	}
	var vendor, untitled bool
	for _, c := range a.Cards() {
		switch c.Title {
		case "Vendor API":
			vendor = true
			if c.Position == nil || c.Position.X != 100 || c.Position.Y != 200 {
				t.Errorf("Vendor API position = %+v, want paste origin", c.Position)
			}
		case "Untitled":
			untitled = true
		}
	}
	if !vendor || !untitled {
		t.Error("expected both pasted cards to exist")
	}
}

// A table-shaped paste mints a List through the wired seams (headers
// from the first row, keys slugged) and lands its projection card.
func TestPasteToBoard_TableBecomesListProjection(t *testing.T) {
	a := newTestAtlasService(t)
	wireFakeProjection(a)
	var gotLabel string
	var gotFields []typedfield.Field
	var gotRows []map[string]string
	a.WirePasteListWrites(
		func(label string, columns []typedfield.Field) (string, error) {
			gotLabel, gotFields = label, columns
			return "list-vendors", nil
		},
		func(listID string, values map[string]string) error {
			gotRows = append(gotRows, values)
			return nil
		},
	)
	res, err := a.PasteToBoard(pasteTableXML, "", 0, 0)
	if err != nil {
		t.Fatalf("PasteToBoard: %v", err)
	}
	if res.Tables != 1 || res.Cards != 0 {
		t.Fatalf("result = %+v, want exactly one table and no stray cards", res)
	}
	if gotLabel != "Vendors" {
		t.Errorf("list label = %q, want Vendors", gotLabel)
	}
	if len(gotFields) != 2 || gotFields[0].Key != "name" || gotFields[1].Key != "status" {
		t.Errorf("fields = %+v, want slugged name/status", gotFields)
	}
	if len(gotRows) != 1 || gotRows[0]["name"] != "Acme" || gotRows[0]["status"] != "Healthy" {
		t.Errorf("rows = %+v, want the one data row", gotRows)
	}
	var projected bool
	for _, c := range a.Cards() {
		if c.ProjectionListID == "list-vendors" && c.Title == "Vendors" {
			projected = true
		}
	}
	if !projected {
		t.Error("expected the projection card for the minted list")
	}
}

// Unrecognized text creates nothing and reports Recognized=false.
func TestPasteToBoard_OrdinaryTextIsLeftAlone(t *testing.T) {
	a := newTestAtlasService(t)
	before := len(a.Cards())
	res, err := a.PasteToBoard("meeting notes: follow up with the vendor", "", 0, 0)
	if err != nil {
		t.Fatalf("PasteToBoard: %v", err)
	}
	if res.Recognized || len(a.Cards()) != before {
		t.Fatalf("ordinary text must be left alone, got %+v", res)
	}
}

// TSV (goal 0138 slice 2): a copied spreadsheet range converts; prose
// with a stray tab, or a single line, never does.
func TestPasteToBoard_TSVBecomesTable(t *testing.T) {
	a := newTestAtlasService(t)
	wireFakeProjection(a)
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
	res, err := a.PasteToBoard("Name\tStatus\nAcme\tHealthy\nGlobex\tBlocked", "", 0, 0)
	if err != nil {
		t.Fatalf("PasteToBoard: %v", err)
	}
	if !res.Recognized || res.Tables != 1 {
		t.Fatalf("result = %+v, want one table", res)
	}
	if len(gotFields) != 2 || gotFields[0].Key != "name" || gotFields[1].Key != "status" {
		t.Errorf("fields = %+v, want name/status headers", gotFields)
	}
	if len(gotRows) != 2 || gotRows[1]["status"] != "Blocked" {
		t.Errorf("rows = %+v, want two data rows", gotRows)
	}

	for _, notTSV := range []string{"prose with\ta tab", "one\ttab\nbut\tthis\tline differs", "Name\tStatus"} {
		if r, _ := a.PasteToBoard(notTSV, "", 0, 0); r.Recognized {
			t.Errorf("%q must not convert", notTSV)
		}
	}
}
