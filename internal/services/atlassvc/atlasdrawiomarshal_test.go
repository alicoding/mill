package atlassvc

import (
	"encoding/xml"
	"reflect"
	"testing"
)

// The export slice's own foundation: atlaspaste.go's mxCell/mxGeometry/
// mxDiagram/mxFile structs already unmarshal a real draw.io file;
// encoding/xml marshals with the SAME tags. These property tests prove
// that holds against the paste ladder's own fixtures (atlaspaste_test.go):
// unmarshal(marshal(unmarshal(fixture))) must equal unmarshal(fixture) --
// nothing is lost or reshaped by a marshal/unmarshal round trip.
func TestMxGraphModelMarshalRoundTrips(t *testing.T) {
	fixtures := map[string]string{
		"diagram":   pasteDiagramXML,
		"container": pasteContainerXML,
		"deepNest":  pasteDeepNestXML,
		"table":     pasteTableXML,
	}
	for name, src := range fixtures {
		t.Run(name, func(t *testing.T) {
			var want mxGraphModel
			if err := xml.Unmarshal([]byte(src), &want); err != nil {
				t.Fatalf("unmarshal fixture: %v", err)
			}
			data, err := xml.Marshal(want)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			var got mxGraphModel
			if err := xml.Unmarshal(data, &got); err != nil {
				t.Fatalf("re-unmarshal marshaled output: %v\n%s", err, data)
			}
			if !reflect.DeepEqual(want, got) {
				t.Errorf("round trip mismatch:\nwant %+v\ngot  %+v\nmarshaled: %s", want, got, data)
			}
		})
	}
}

// The multi-page mxfile wrapper round-trips too, including a page whose
// content is unparseable chardata (pasteMultiPageXML's own "Broken
// Page") -- marshal must not choke on or reshape that raw text.
func TestMxFileMarshalRoundTrips(t *testing.T) {
	var want mxFile
	if err := xml.Unmarshal([]byte(pasteMultiPageXML), &want); err != nil {
		t.Fatalf("unmarshal fixture: %v", err)
	}
	data, err := xml.Marshal(want)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var got mxFile
	if err := xml.Unmarshal(data, &got); err != nil {
		t.Fatalf("re-unmarshal marshaled output: %v\n%s", err, data)
	}
	if !reflect.DeepEqual(want, got) {
		t.Errorf("round trip mismatch:\nwant %+v\ngot  %+v\nmarshaled: %s", want, got, data)
	}
}

// A cell's multi-line Value (goal 0194's own <br>/newline paste fixture)
// carries a literal newline through an XML attribute -- encoding/xml
// must escape and unescape it losslessly, not just plain ASCII values.
func TestMxCellMarshal_MultiLineValueRoundTrips(t *testing.T) {
	cell := mxCell{ID: "c:1", Value: "Vendor API\nHandles auth\nOwner: SRE", Style: "rounded=0;", Vertex: "1", Parent: "1",
		Geometry: &mxGeometry{X: 10, Y: 20, W: 120, H: 60, As: "geometry"}}
	data, err := xml.Marshal(mxGraphModel{Cells: []mxCell{cell}})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var got mxGraphModel
	if err := xml.Unmarshal(data, &got); err != nil {
		t.Fatalf("unmarshal: %v\n%s", err, data)
	}
	if len(got.Cells) != 1 || got.Cells[0].Value != cell.Value {
		t.Errorf("Value = %q, want %q (marshaled: %s)", got.Cells[0].Value, cell.Value, data)
	}
}
