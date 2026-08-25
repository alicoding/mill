package atlassvc

import (
	"bytes"
	"compress/flate"
	"encoding/base64"
	"net/url"
	"testing"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/domain/typedfield"
)

const pasteDiagramXML = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>` +
	`<mxCell id="2" value="Vendor API" vertex="1" parent="1"><mxGeometry x="40" y="40" width="120" height="60"/></mxCell>` +
	`<mxCell id="3" value="" vertex="1" parent="1"><mxGeometry x="240" y="40" width="120" height="60"/></mxCell>` +
	`<mxCell id="4" value="calls" edge="1" parent="1" source="2" target="3"/></root></mxGraphModel>`

// A synthetic 3-page file: pages 1 and 2 deliberately reuse the same
// local cell ids (0/1/2/3/4), the shape a real draw.io export takes
// when every page starts its own layer numbering from scratch. Page 3
// is corrupt on purpose.
const pasteMultiPageXML = `<mxfile>` +
	`<diagram name="Runtime Path"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>` +
	`<mxCell id="2" value="Runtime" vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40"/></mxCell>` +
	`<mxCell id="3" value="Webhook" vertex="1" parent="1"><mxGeometry x="200" y="0" width="80" height="40"/></mxCell>` +
	`<mxCell id="4" value="triggers" edge="1" parent="1" source="2" target="3"/>` +
	`</root></mxGraphModel></diagram>` +
	`<diagram name="Vendor Readiness"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>` +
	`<mxCell id="2" value="Vendor A" vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40"/></mxCell>` +
	`<mxCell id="3" value="Vendor B" vertex="1" parent="1"><mxGeometry x="200" y="0" width="80" height="40"/></mxCell>` +
	`<mxCell id="4" value="depends on" edge="1" parent="1" source="2" target="3"/>` +
	`</root></mxGraphModel></diagram>` +
	`<diagram name="Broken Page">not valid diagram content at all</diagram>` +
	`</mxfile>`

// A single-page fixture with a container (swimlane), a nested vertex
// carrying a multi-line label, and a sibling vertex left at the top
// level.
const pasteContainerXML = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>` +
	`<mxCell id="lane" value="Runtime Path" vertex="1" parent="1"><mxGeometry x="0" y="0" width="400" height="200"/></mxCell>` +
	`<mxCell id="v1" value="Vendor API&#10;Handles auth&#10;Owner: SRE" vertex="1" parent="lane"><mxGeometry x="20" y="40" width="120" height="60"/></mxCell>` +
	`<mxCell id="v2" value="Free node" vertex="1" parent="1"><mxGeometry x="500" y="40" width="120" height="60"/></mxCell>` +
	`</root></mxGraphModel>`

// Three levels deep, proving containment isn't hardcoded to one level.
const pasteDeepNestXML = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>` +
	`<mxCell id="outer" value="Outer" vertex="1" parent="1"><mxGeometry width="100" height="100"/></mxCell>` +
	`<mxCell id="inner" value="Inner" vertex="1" parent="outer"><mxGeometry width="60" height="60"/></mxCell>` +
	`<mxCell id="leaf" value="Leaf" vertex="1" parent="inner"><mxGeometry width="20" height="20"/></mxCell>` +
	`</root></mxGraphModel>`

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
	if _, _, ok := decodeDiagramText(pasteDiagramXML); !ok {
		t.Fatal("raw XML must decode")
	}
	if _, _, ok := decodeDiagramText(url.PathEscape(pasteDiagramXML)); !ok {
		t.Fatal("URI-encoded must decode")
	}
	var buf bytes.Buffer
	w, _ := flate.NewWriter(&buf, flate.DefaultCompression)
	// encodeURIComponent never emits '+' -- PathEscape mirrors it.
	_, _ = w.Write([]byte(url.PathEscape(pasteDiagramXML)))
	_ = w.Close()
	if _, _, ok := decodeDiagramText(base64.StdEncoding.EncodeToString(buf.Bytes())); !ok {
		t.Fatal("base64+deflate must decode")
	}
	if _, _, ok := decodeDiagramText("just some prose about <tables>"); ok {
		t.Fatal("ordinary text must NOT decode")
	}
}

// A diagram-shaped paste lands cards for vertices (empty label ->
// Untitled) and links for edges, positions offset to the paste point.
func TestPasteToBoard_DiagramBecomesCardsAndLinks(t *testing.T) {
	a := newTestAtlasService(t)
	res, err := a.PasteToBoard(pasteDiagramXML, "", "", 100, 200)
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
// from the first row, keys slugged) and lands a "table" board object
// -- never a card (goal 0179 S2's own correction).
func TestPasteToBoard_TableBecomesBoardObject(t *testing.T) {
	a := newTestAtlasService(t)
	wireFakeProjection(a)
	cardsBefore := len(a.Cards())
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
	res, err := a.PasteToBoard(pasteTableXML, "", "", 0, 0)
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
	if len(a.Cards()) != cardsBefore {
		t.Errorf("expected no card to be created, got %d (was %d)", len(a.Cards()), cardsBefore)
	}
	var projected bool
	for _, o := range a.Objects() {
		if o.Kind == "table" && o.Payload["listID"] == "list-vendors" && o.Payload["title"] == "Vendors" {
			projected = true
		}
	}
	if !projected {
		t.Error("expected a table board object for the minted list")
	}
}

// Unrecognized text creates nothing and reports Recognized=false.
func TestPasteToBoard_OrdinaryTextIsLeftAlone(t *testing.T) {
	a := newTestAtlasService(t)
	before := len(a.Cards())
	res, err := a.PasteToBoard("meeting notes: follow up with the vendor", "", "", 0, 0)
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
	res, err := a.PasteToBoard("Name\tStatus\nAcme\tHealthy\nGlobex\tBlocked", "", "", 0, 0)
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
		if r, _ := a.PasteToBoard(notTSV, "", "", 0, 0); r.Recognized {
			t.Errorf("%q must not convert", notTSV)
		}
	}
}

// Regression (goal 0194): parseMxFile used to return on the first
// diagram page that decoded, silently dropping every other page. Every
// page must import, and the one page that fails to decode must be
// named, not swallowed.
func TestPasteToBoard_MultiPageImportsEveryPageAndReportsSkipped(t *testing.T) {
	a := newTestAtlasService(t)
	res, err := a.PasteToBoard(pasteMultiPageXML, "", "", 0, 0)
	if err != nil {
		t.Fatalf("PasteToBoard: %v", err)
	}
	if res.Cards != 4 || res.Links != 2 {
		t.Fatalf("result = %+v, want all 4 vertices and both edges from both good pages", res)
	}
	if len(res.SkippedPages) != 1 || res.SkippedPages[0] != "Broken Page" {
		t.Fatalf("SkippedPages = %v, want exactly [Broken Page]", res.SkippedPages)
	}
	titles := make(map[string]bool)
	for _, c := range a.Cards() {
		titles[c.Title] = true
	}
	for _, want := range []string{"Runtime", "Webhook", "Vendor A", "Vendor B"} {
		if !titles[want] {
			t.Errorf("missing card %q -- a page was dropped", want)
		}
	}
}

// Regression (goal 0194): mxCell.Parent was parsed and never read, so
// every vertex landed flat under the paste's own parentID. A vertex
// inside a container must land inside that container's card, and its
// multi-line value must split into title + note rather than becoming
// one flattened title.
func TestPasteToBoard_ContainerNestsChildrenAndSplitsMultiLineText(t *testing.T) {
	a := newTestAtlasService(t)
	res, err := a.PasteToBoard(pasteContainerXML, "", "", 0, 0)
	if err != nil {
		t.Fatalf("PasteToBoard: %v", err)
	}
	if res.Cards != 3 {
		t.Fatalf("result = %+v, want 3 cards", res)
	}
	byTitle := make(map[string]atlas.Card)
	for _, c := range a.Cards() {
		byTitle[c.Title] = c
	}
	lane, v1, v2 := byTitle["Runtime Path"], byTitle["Vendor API"], byTitle["Free node"]
	if lane.ID == "" || v1.ID == "" || v2.ID == "" {
		t.Fatalf("expected all three cards, got lane=%+v v1=%+v v2=%+v", lane, v1, v2)
	}
	if v1.ParentID != lane.ID {
		t.Errorf("Vendor API ParentID = %q, want the container %q", v1.ParentID, lane.ID)
	}
	if v2.ParentID != "" {
		t.Errorf("Free node ParentID = %q, want root-level (paste's own parentID)", v2.ParentID)
	}
	if v1.Note != "Handles auth\nOwner: SRE" {
		t.Errorf("Vendor API note = %q, want the detail lines", v1.Note)
	}
}

// Containment isn't hardcoded to one level: a vertex nested inside a
// container that is itself nested lands under its immediate container,
// which lands under its own -- not collapsed to the paste's parentID.
func TestPasteToBoard_ContainmentNestsArbitraryDepth(t *testing.T) {
	a := newTestAtlasService(t)
	res, err := a.PasteToBoard(pasteDeepNestXML, "", "", 0, 0)
	if err != nil {
		t.Fatalf("PasteToBoard: %v", err)
	}
	if res.Cards != 3 {
		t.Fatalf("result = %+v, want 3 cards", res)
	}
	byTitle := make(map[string]atlas.Card)
	for _, c := range a.Cards() {
		byTitle[c.Title] = c
	}
	outer, inner, leaf := byTitle["Outer"], byTitle["Inner"], byTitle["Leaf"]
	if inner.ParentID != outer.ID {
		t.Errorf("Inner ParentID = %q, want Outer %q", inner.ParentID, outer.ID)
	}
	if leaf.ParentID != inner.ID {
		t.Errorf("Leaf ParentID = %q, want Inner %q", leaf.ParentID, inner.ID)
	}
}

// splitVertexText handles both encodings a source tool uses for a
// multi-line vertex label: literal newlines and <br> tags.
func TestSplitVertexText(t *testing.T) {
	cases := []struct{ in, title, note string }{
		{"Just a title", "Just a title", ""},
		{"Heading\nDetail one\nDetail two", "Heading", "Detail one\nDetail two"},
		{"Heading<br>Detail one<br/>Detail two", "Heading", "Detail one\nDetail two"},
		{"", "Untitled", ""},
	}
	for _, c := range cases {
		title, note := splitVertexText(c.in)
		if title != c.title || note != c.note {
			t.Errorf("splitVertexText(%q) = (%q, %q), want (%q, %q)", c.in, title, note, c.title, c.note)
		}
	}
}
