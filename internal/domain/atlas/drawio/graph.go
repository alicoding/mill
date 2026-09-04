package drawio

import (
	"encoding/xml"
	"fmt"
	"html"
	"strconv"
	"strings"
)

// The editable view of one page's model. Unlike GraphModel (model.go),
// which flattens a diagram into the narrow set of attributes Mill's
// paste/export round trip reads, this view keeps every element and
// every attribute verbatim: a cell Mill edits keeps the style keys,
// child <mxPoint>s and custom attributes it arrived with, and a cell
// Mill never names is re-emitted exactly as parsed. That fidelity is
// the whole point of editing in place instead of regenerating the file.

// RootLayerID is mxGraph's mandatory default layer; RootCellID is the
// model root above it. Neither is ever deletable.
const (
	RootCellID  = "0"
	RootLayerID = "1"
)

type xmlNode struct {
	XMLName xml.Name
	Attrs   []xml.Attr `xml:",any,attr"`
	Inner   string     `xml:",innerxml"`
}

type xmlRoot struct {
	XMLName  xml.Name  `xml:"root"`
	Children []xmlNode `xml:",any"`
}

type xmlModel struct {
	XMLName xml.Name   `xml:"mxGraphModel"`
	Attrs   []xml.Attr `xml:",any,attr"`
	Root    xmlRoot    `xml:"root"`
}

// GeometryOut is a cell's placement as the agent-facing tools express
// it -- every field a pointer so a patch can say "leave this one".
type GeometryOut struct {
	X *float64 `json:"x,omitempty"`
	Y *float64 `json:"y,omitempty"`
	W *float64 `json:"width,omitempty"`
	H *float64 `json:"height,omitempty"`
}

// CellOut is one vertex or edge as the read tool reports it.
type CellOut struct {
	ID       string       `json:"id"`
	Kind     string       `json:"kind"`
	Label    string       `json:"label,omitempty"`
	Style    string       `json:"style,omitempty"`
	Parent   string       `json:"parent,omitempty"`
	Source   string       `json:"source,omitempty"`
	Target   string       `json:"target,omitempty"`
	Geometry *GeometryOut `json:"geometry,omitempty"`
}

// LayerOut is one layer cell (a child of the model root).
type LayerOut struct {
	ID      string `json:"id"`
	Name    string `json:"name,omitempty"`
	Visible bool   `json:"visible"`
}

// PageOut names one page of the file.
type PageOut struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// KindVertex/KindEdge are the two cell kinds the tools speak.
const (
	KindVertex = "vertex"
	KindEdge   = "edge"
)

func parseModel(modelXML string) (*xmlModel, error) {
	if strings.TrimSpace(modelXML) == "" {
		return &xmlModel{XMLName: xml.Name{Local: "mxGraphModel"}}, nil
	}
	var m xmlModel
	if err := xml.Unmarshal([]byte(modelXML), &m); err != nil {
		return nil, fmt.Errorf("this page is not a readable diagram model: %w", err)
	}
	return &m, nil
}

func (m *xmlModel) marshal() (string, error) {
	if m.Root.XMLName.Local == "" {
		m.Root.XMLName = xml.Name{Local: "root"}
	}
	m.XMLName = xml.Name{Local: "mxGraphModel"}
	data, err := xml.Marshal(m)
	if err != nil {
		return "", fmt.Errorf("write diagram model: %w", err)
	}
	return string(data), nil
}

// cellNode locates the mxCell carrying a child's graph attributes: for
// a plain <mxCell> that is the node itself; for draw.io's <object>/
// <UserObject> label wrapper it is the nested <mxCell>, whose own
// attributes hold style/vertex/edge/parent/source/target.
func (n *xmlNode) isWrapper() bool {
	return n.XMLName.Local == "object" || n.XMLName.Local == "UserObject"
}

func (n *xmlNode) innerCell() (xmlNode, bool) {
	if !n.isWrapper() {
		return *n, false
	}
	var inner struct {
		Cell xmlNode `xml:"mxCell"`
	}
	if xml.Unmarshal([]byte("<w>"+n.Inner+"</w>"), &inner) != nil {
		return xmlNode{}, false
	}
	return inner.Cell, true
}

func (n *xmlNode) id() string { return attrValue(n.Attrs, "id") }

// label is a cell's own display text: the wrapper's "label" attribute
// when it has one, otherwise "value". HTML entities are decoded so an
// agent reads the text a person sees, never "Order &amp; pay".
func (n *xmlNode) label() string {
	if v := attrValue(n.Attrs, "label"); v != "" {
		return html.UnescapeString(v)
	}
	return html.UnescapeString(attrValue(n.Attrs, "value"))
}

func geometryOf(cell xmlNode) *GeometryOut {
	var wrap struct {
		Geoms []xmlNode `xml:"mxGeometry"`
	}
	if xml.Unmarshal([]byte("<w>"+cell.Inner+"</w>"), &wrap) != nil || len(wrap.Geoms) == 0 {
		return nil
	}
	g := wrap.Geoms[0]
	out := &GeometryOut{
		X: floatAttr(g.Attrs, "x"), Y: floatAttr(g.Attrs, "y"),
		W: floatAttr(g.Attrs, "width"), H: floatAttr(g.Attrs, "height"),
	}
	if out.X == nil && out.Y == nil && out.W == nil && out.H == nil {
		return nil
	}
	return out
}

func floatAttr(attrs []xml.Attr, name string) *float64 {
	raw := attrValue(attrs, name)
	if raw == "" {
		return nil
	}
	v, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return nil
	}
	return &v
}

func cellKind(cell xmlNode) string {
	switch {
	case attrValue(cell.Attrs, "edge") == "1":
		return KindEdge
	case attrValue(cell.Attrs, "vertex") == "1":
		return KindVertex
	}
	return ""
}

// ReadPage reports a page's layers and its vertex/edge cells. Cells
// that are neither (the model root and the layer cells themselves)
// are reported as layers instead, never as graph content.
func ReadPage(p *Page) (layers []LayerOut, cells []CellOut, err error) {
	m, err := parseModel(p.ModelXML())
	if err != nil {
		return nil, nil, err
	}
	layers, cells = []LayerOut{}, []CellOut{}
	for i := range m.Root.Children {
		n := &m.Root.Children[i]
		cell, _ := n.innerCell()
		kind := cellKind(cell)
		if kind == "" {
			if id := n.id(); id != "" && id != RootCellID {
				layers = append(layers, LayerOut{ID: id, Name: n.label(), Visible: attrValue(cell.Attrs, "visible") != "0"})
			}
			continue
		}
		cells = append(cells, CellOut{
			ID: n.id(), Kind: kind, Label: n.label(),
			Style:    attrValue(cell.Attrs, "style"),
			Parent:   attrValue(cell.Attrs, "parent"),
			Source:   attrValue(cell.Attrs, "source"),
			Target:   attrValue(cell.Attrs, "target"),
			Geometry: geometryOf(cell),
		})
	}
	return layers, cells, nil
}

// PagesOf names every page of the document in file order.
func PagesOf(d *Document) []PageOut {
	out := make([]PageOut, 0, len(d.Pages()))
	for i, p := range d.Pages() {
		out = append(out, PageOut{ID: p.ID(), Name: PageName(p.Name(), i)})
	}
	return out
}
