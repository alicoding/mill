// Package drawio owns draw.io's own file model -- the mxCell graph, its
// three wire forms, and the in-place cell edits Mill's MCP plane
// performs on them (goal 0323). Split out of atlassvc so both call
// sites share one model: the paste/export round trip
// (atlassvc.atlaspaste.go, atlasboarddrawio.go, which alias these types)
// and the agent-facing diagram tools (mcpsvc).
//
// Nothing here touches the filesystem or any service -- pure model +
// wire handling, the same domain-package purity rule the rest of
// internal/domain/atlas holds to.
package drawio

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

// Cell is the diagram model's one node type; geometry carries
// placement for vertices and ordering for table rows/cells.
type Cell struct {
	ID       string    `xml:"id,attr"`
	Value    string    `xml:"value,attr,omitempty"`
	Style    string    `xml:"style,attr,omitempty"`
	Vertex   string    `xml:"vertex,attr,omitempty"`
	Edge     string    `xml:"edge,attr,omitempty"`
	Parent   string    `xml:"parent,attr,omitempty"`
	Source   string    `xml:"source,attr,omitempty"`
	Target   string    `xml:"target,attr,omitempty"`
	Geometry *Geometry `xml:"mxGeometry"`
}

type Geometry struct {
	X float64 `xml:"x,attr,omitempty"`
	Y float64 `xml:"y,attr,omitempty"`
	W float64 `xml:"width,attr"`
	H float64 `xml:"height,attr"`
	// As mirrors real draw.io output ("as=\"geometry\"", distinguishing
	// a cell's placement from any other named child element mxGraph's
	// own format allows) -- optional for Unmarshal, set by every
	// geometry an export builds.
	As string `xml:"as,attr,omitempty"`
}

type GraphModel struct {
	Cells []Cell `xml:"root>mxCell"`
}

// Diagram is one page of an mxfile; its content is either inline XML
// (uncompressed save format) or a compressed payload carried as the
// element's own chardata.
type Diagram struct {
	ID      string      `xml:"id,attr,omitempty"`
	Name    string      `xml:"name,attr"`
	Inline  *GraphModel `xml:"mxGraphModel"`
	Content string      `xml:",chardata"`
}

// File wraps one or more diagram pages. XMLName pins the marshaled
// root tag to the lowercase "mxfile" every real draw.io file already
// uses.
type File struct {
	XMLName  xml.Name  `xml:"mxfile"`
	Host     string    `xml:"host,attr,omitempty"`
	Diagrams []Diagram `xml:"diagram"`
}

// xmlDeclPattern matches a leading XML declaration -- present on every
// .drawio FILE saved to disk but absent from draw.io's own clipboard
// payload. Stripped once, deterministically, before the prefix checks
// below so both wire shapes recognize the same way -- not a heuristic,
// since a leading "<?xml ... ?>" has exactly one meaning.
var xmlDeclPattern = regexp.MustCompile(`^<\?xml[^>]*\?>\s*`)

// StripXMLDeclaration removes a leading XML declaration from text.
func StripXMLDeclaration(text string) string {
	return xmlDeclPattern.ReplaceAllString(strings.TrimSpace(text), "")
}

// DecodeDiagramText runs the decode ladder and returns the merged
// model plus the name of any page that failed to decode. ok=false
// means "not diagram-shaped at all" -- the caller leaves the input
// alone. A non-nil skipped with ok=true means SOME pages came through
// but others did not; the caller must surface that, never drop it.
func DecodeDiagramText(text string) (GraphModel, []string, bool) {
	text = StripXMLDeclaration(text)
	if text == "" {
		return GraphModel{}, nil, false
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

func decodeBase64Deflate(text string) (GraphModel, []string, bool) {
	decoded, ok := InflateWireText(text)
	if !ok {
		return GraphModel{}, nil, false
	}
	return parseModelXML(strings.TrimSpace(decoded))
}

// InflateWireText decodes draw.io's compressed wire form (base64 of a
// raw-deflate stream whose payload is URI-encoded XML) back to XML.
// ok=false means text is not that form at all.
func InflateWireText(text string) (string, bool) {
	raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(text))
	if err != nil {
		return "", false
	}
	inflated, err := io.ReadAll(flate.NewReader(bytes.NewReader(raw)))
	if err != nil {
		return "", false
	}
	decoded, err := url.PathUnescape(string(inflated))
	if err != nil {
		return "", false
	}
	return decoded, true
}

func parseModelXML(text string) (GraphModel, []string, bool) {
	if strings.HasPrefix(text, "<mxGraphModel") {
		var m GraphModel
		if xml.Unmarshal([]byte(text), &m) == nil && len(m.Cells) > 0 {
			return m, nil, true
		}
		return GraphModel{}, nil, false
	}
	if strings.HasPrefix(text, "<mxfile") {
		return parseMxFile(text)
	}
	return GraphModel{}, nil, false
}

// parseMxFile decodes every page and merges their cells into one
// model. A page's cell ids are prefixed before merging so two pages
// that each reuse the tool's own default ids (draw.io layers commonly
// start every page at id "0"/"1") never collide once flattened. ok is
// true whenever the file names at least one page -- even if every page
// individually failed to decode -- so a fully-corrupt multi-page file
// is reported as "recognized, everything skipped" rather than silently
// doing nothing.
func parseMxFile(text string) (GraphModel, []string, bool) {
	var f File
	if xml.Unmarshal([]byte(text), &f) != nil || len(f.Diagrams) == 0 {
		return GraphModel{}, nil, false
	}
	var merged GraphModel
	var skipped []string
	for i, d := range f.Diagrams {
		cells, ok := decodeOnePage(d)
		if !ok {
			skipped = append(skipped, PageName(d.Name, i))
			continue
		}
		merged.Cells = append(merged.Cells, prefixPageCells(cells, fmt.Sprintf("p%d:", i))...)
	}
	return merged, skipped, true
}

func decodeOnePage(d Diagram) ([]Cell, bool) {
	if d.Inline != nil && len(d.Inline.Cells) > 0 {
		return d.Inline.Cells, true
	}
	m, _, ok := DecodeDiagramText(strings.TrimSpace(d.Content))
	if !ok {
		return nil, false
	}
	return m.Cells, true
}

// PageName is a page's display name, falling back to its 1-based
// position when the file names none.
func PageName(name string, index int) string {
	if name != "" {
		return name
	}
	return fmt.Sprintf("Page %d", index+1)
}

// prefixPageCells renames every id a page's own cells reference
// (an mxGraph cell never points outside its own diagram page) so
// merging pages from parseMxFile can never let one page's cell shadow
// another's.
func prefixPageCells(cells []Cell, prefix string) []Cell {
	out := make([]Cell, len(cells))
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
