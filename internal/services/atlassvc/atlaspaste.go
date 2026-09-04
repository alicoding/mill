package atlassvc

import (
	"strings"

	"github.com/alicoding/mill/internal/domain/atlas/drawio"
)

// Paste understanding (docs/goals/0138, 0194, 0179 S2): clipboard text
// that carries a diagramming tool's cell model becomes Mill's OWN
// primitives -- table shapes become a List + a "table" board object,
// plain vertices become cards, edges become links. Detection is a
// deterministic decode ladder, never a heuristic: parse as XML; else
// URI-decode; else base64+inflate+URI-decode (the tool's own three
// wire forms). This file owns the ladder itself (wire text -> a merged
// mxGraphModel); atlaspastebuild.go turns that model into cards, links
// and lists.
//
// These same structs also drive the REVERSE direction (goal 0194's
// export slice): encoding/xml marshals with the identical tags it
// unmarshals with, so atlasboarddrawio.go builds mxCell/mxGeometry/
// mxDiagram/mxFile values and calls xml.Marshal -- no separate writer
// type.

// The mx* model and draw.io's three wire forms live in
// internal/domain/atlas/drawio, shared with the agent-facing diagram
// tools (goal 0323). These aliases keep this package's own paste and
// export code -- and its tests -- reading exactly as they did when the
// structs were declared here.
type (
	mxCell       = drawio.Cell
	mxGeometry   = drawio.Geometry
	mxGraphModel = drawio.GraphModel
	mxDiagram    = drawio.Diagram
	mxFile       = drawio.File
)

// decodeDiagramText runs the decode ladder and returns the merged
// model plus the name of any page that failed to decode. ok=false
// means "not diagram-shaped at all" -- the caller leaves the paste
// alone. A non-nil skipped with ok=true means SOME pages came through
// but others did not; the caller must surface that, never drop it.
func decodeDiagramText(text string) (mxGraphModel, []string, bool) {
	return drawio.DecodeDiagramText(text)
}

func styleHasShape(style, shape string) bool {
	return strings.HasPrefix(style, "shape="+shape) || strings.Contains(style, ";shape="+shape)
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
