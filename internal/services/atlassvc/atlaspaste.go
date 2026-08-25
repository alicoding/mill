package atlassvc

import (
	"bytes"
	"compress/flate"
	"encoding/base64"
	"encoding/xml"
	"fmt"
	"io"
	"net/url"
	"regexp"
	"strings"
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
// type. The extra fields below (XMLName/Host, mxDiagram.ID, mxGeometry.As)
// exist only to make marshaled output match a real draw.io file's own
// shape; they're additive and every `,omitempty` is inert for
// Unmarshal, so the import ladder above is untouched.

// mxCell is the diagram model's one node type; geometry carries
// placement for vertices and ordering for table rows/cells.
type mxCell struct {
	ID       string      `xml:"id,attr"`
	Value    string      `xml:"value,attr,omitempty"`
	Style    string      `xml:"style,attr,omitempty"`
	Vertex   string      `xml:"vertex,attr,omitempty"`
	Edge     string      `xml:"edge,attr,omitempty"`
	Parent   string      `xml:"parent,attr,omitempty"`
	Source   string      `xml:"source,attr,omitempty"`
	Target   string      `xml:"target,attr,omitempty"`
	Geometry *mxGeometry `xml:"mxGeometry"`
}

type mxGeometry struct {
	X float64 `xml:"x,attr,omitempty"`
	Y float64 `xml:"y,attr,omitempty"`
	W float64 `xml:"width,attr"`
	H float64 `xml:"height,attr"`
	// As mirrors real draw.io output ("as=\"geometry\"", distinguishing
	// a cell's placement from any other named child element mxGraph's
	// own format allows) -- optional for Unmarshal (ignored either way
	// by the paste ladder above), set by every geometry export builds.
	As string `xml:"as,attr,omitempty"`
}

type mxGraphModel struct {
	Cells []mxCell `xml:"root>mxCell"`
}

// mxDiagram is one page of an mxfile; its content is either inline XML
// (uncompressed save format) or a compressed payload carried as the
// element's own chardata.
type mxDiagram struct {
	ID      string        `xml:"id,attr,omitempty"`
	Name    string        `xml:"name,attr"`
	Inline  *mxGraphModel `xml:"mxGraphModel"`
	Content string        `xml:",chardata"`
}

// mxFile wraps one or more diagram pages. XMLName pins the marshaled
// root tag to the lowercase "mxfile" every real draw.io file (and
// every fixture in this package) already uses -- Unmarshal already
// required that match implicitly (parseMxFile only reaches here after
// its own `strings.HasPrefix(text, "<mxfile")` check), so declaring it
// explicitly changes nothing for the import ladder.
type mxFile struct {
	XMLName  xml.Name    `xml:"mxfile"`
	Host     string      `xml:"host,attr,omitempty"`
	Diagrams []mxDiagram `xml:"diagram"`
}

// xmlDeclPattern matches a leading XML declaration -- present on every
// .drawio FILE saved to disk (including this package's own
// ExportBoardAsDrawio output, atlasboarddrawio.go) but absent from
// draw.io's own clipboard payload (what this ladder was originally
// built against). Stripped once, deterministically, before the prefix
// checks below so both wire shapes recognize the same way -- not a
// heuristic, since a leading "<?xml ... ?>" has exactly one meaning.
var xmlDeclPattern = regexp.MustCompile(`^<\?xml[^>]*\?>\s*`)

// decodeDiagramText runs the decode ladder and returns the merged
// model plus the name of any page that failed to decode. ok=false
// means "not diagram-shaped at all" -- the caller leaves the paste
// alone. A non-nil skipped with ok=true means SOME pages came through
// but others did not; the caller must surface that, never drop it.
func decodeDiagramText(text string) (mxGraphModel, []string, bool) {
	text = xmlDeclPattern.ReplaceAllString(strings.TrimSpace(text), "")
	if text == "" {
		return mxGraphModel{}, nil, false
	}
	if m, skipped, ok := parseModelXML(text); ok {
		return m, skipped, true
	}
	if decoded, err := url.PathUnescape(text); err == nil && decoded != text {
		if m, skipped, ok := parseModelXML(strings.TrimSpace(decoded)); ok {
			return m, skipped, true
		}
	}
	return decodeBase64Deflate(text)
}

func decodeBase64Deflate(text string) (mxGraphModel, []string, bool) {
	raw, err := base64.StdEncoding.DecodeString(text)
	if err != nil {
		return mxGraphModel{}, nil, false
	}
	inflated, err := io.ReadAll(flate.NewReader(bytes.NewReader(raw)))
	if err != nil {
		return mxGraphModel{}, nil, false
	}
	decoded, err := url.PathUnescape(string(inflated))
	if err != nil {
		return mxGraphModel{}, nil, false
	}
	return parseModelXML(strings.TrimSpace(decoded))
}

func parseModelXML(text string) (mxGraphModel, []string, bool) {
	if strings.HasPrefix(text, "<mxGraphModel") {
		var m mxGraphModel
		if xml.Unmarshal([]byte(text), &m) == nil && len(m.Cells) > 0 {
			return m, nil, true
		}
		return mxGraphModel{}, nil, false
	}
	if strings.HasPrefix(text, "<mxfile") {
		return parseMxFile(text)
	}
	return mxGraphModel{}, nil, false
}

// parseMxFile decodes every page and merges their cells into one
// model. A page's cell ids are prefixed before merging so two pages
// that each reuse the tool's own default ids (draw.io layers commonly
// start every page at id "0"/"1") never collide once flattened. ok is
// true whenever the file names at least one page -- even if every page
// individually failed to decode -- so a fully-corrupt multi-page file
// is reported as "recognized, everything skipped" rather than silently
// doing nothing.
func parseMxFile(text string) (mxGraphModel, []string, bool) {
	var f mxFile
	if xml.Unmarshal([]byte(text), &f) != nil || len(f.Diagrams) == 0 {
		return mxGraphModel{}, nil, false
	}
	var merged mxGraphModel
	var skipped []string
	for i, d := range f.Diagrams {
		cells, ok := decodeOnePage(d)
		if !ok {
			skipped = append(skipped, pageName(d.Name, i))
			continue
		}
		merged.Cells = append(merged.Cells, prefixPageCells(cells, fmt.Sprintf("p%d:", i))...)
	}
	return merged, skipped, true
}

func decodeOnePage(d mxDiagram) ([]mxCell, bool) {
	if d.Inline != nil && len(d.Inline.Cells) > 0 {
		return d.Inline.Cells, true
	}
	m, _, ok := decodeDiagramText(strings.TrimSpace(d.Content))
	if !ok {
		return nil, false
	}
	return m.Cells, true
}

func pageName(name string, index int) string {
	if name != "" {
		return name
	}
	return fmt.Sprintf("Page %d", index+1)
}

// prefixPageCells renames every id a page's own cells reference
// (an mxGraph cell never points outside its own diagram page) so
// merging pages from parseMxFile can never let one page's cell shadow
// another's.
func prefixPageCells(cells []mxCell, prefix string) []mxCell {
	out := make([]mxCell, len(cells))
	for i, c := range cells {
		c.ID = prefix + c.ID
		if c.Parent != "" {
			c.Parent = prefix + c.Parent
		}
		if c.Source != "" {
			c.Source = prefix + c.Source
		}
		if c.Target != "" {
			c.Target = prefix + c.Target
		}
		out[i] = c
	}
	return out
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
