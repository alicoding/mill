package drawio

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/xml"
	"fmt"
	"strconv"
	"strings"
)

// In-place cell edits (goal 0323). Every operation below rewrites ONLY
// the cells it was given ids for; every other element of the page --
// and every other page of the file -- comes back out as it went in.
// That is the whole difference between editing a diagram and
// regenerating one.

// Defaults a new cell inherits when the caller names none. The style
// strings match what this repo's own board export already writes
// (atlasboarddrawio.go), so a Mill-authored diagram reads the same
// however it was produced.
const (
	DefaultVertexStyle  = "rounded=0;whiteSpace=wrap;html=1;"
	DefaultEdgeStyle    = "edgeStyle=orthogonalEdgeStyle;html=1;"
	defaultVertexX      = 40.0
	defaultVertexY      = 40.0
	defaultVertexWidth  = 120.0
	defaultVertexHeight = 60.0
)

// CellSpec is one cell to create.
type CellSpec struct {
	ID       string       `json:"id,omitempty" jsonschema:"optional: your own id for this cell. Must be unique on the page; omit and Mill mints one."`
	Kind     string       `json:"kind" jsonschema:"vertex (a shape) or edge (a connector)"`
	Label    string       `json:"label,omitempty" jsonschema:"optional: the text shown on the cell"`
	Style    string       `json:"style,omitempty" jsonschema:"optional: a draw.io style string (key=value; pairs). Omit for the default shape or connector style."`
	Parent   string       `json:"parent,omitempty" jsonschema:"optional: the id of the layer or container cell this belongs to. Defaults to the diagram's default layer."`
	Source   string       `json:"source,omitempty" jsonschema:"an edge's starting cell id (required for kind=edge)"`
	Target   string       `json:"target,omitempty" jsonschema:"an edge's ending cell id (required for kind=edge)"`
	Geometry *GeometryOut `json:"geometry,omitempty" jsonschema:"optional: x, y, width and height for a shape. Defaults to a 120x60 box at 40,40."`
}

// CellPatch names one cell and only the parts of it to change. An
// omitted (or empty) field leaves that part of the cell alone -- the
// same additive-update contract atlas_propose_card_write already has.
type CellPatch struct {
	ID    string `json:"id" jsonschema:"the cell's id (from atlas_read_diagram)"`
	Label string `json:"label,omitempty" jsonschema:"new text for the cell; omit to leave it unchanged"`
	// ClearLabel is how a label is REMOVED: an empty Label string is
	// indistinguishable from an omitted one on the wire, so erasing
	// text needs its own flag rather than a sentinel value.
	ClearLabel bool         `json:"clearLabel,omitempty" jsonschema:"set the cell's text to nothing; an empty label alone means unchanged"`
	Style      string       `json:"style,omitempty" jsonschema:"new draw.io style string; omit to leave it unchanged"`
	Parent     string       `json:"parent,omitempty" jsonschema:"move the cell into this layer or container cell; omit to leave it where it is"`
	Source     string       `json:"source,omitempty" jsonschema:"reconnect an edge's start to this cell id; omit to leave it unchanged"`
	Target     string       `json:"target,omitempty" jsonschema:"reconnect an edge's end to this cell id; omit to leave it unchanged"`
	Geometry   *GeometryOut `json:"geometry,omitempty" jsonschema:"move or resize the cell -- only the coordinates you name change"`
}

// newLabel is the text a patch writes: ClearLabel wins, so a call
// that names both erases rather than writes.
func (p CellPatch) newLabel() string {
	if p.ClearLabel {
		return ""
	}
	return p.Label
}

// MintCellID makes an id no draw.io author would ever type by hand, so
// a Mill-created cell is recognizable in the file itself.
func MintCellID() string {
	var b [4]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "mill-00000000"
	}
	return "mill-" + hex.EncodeToString(b[:])
}

// AddCells appends specs to the page and returns the ids they landed
// under, in the order given. Nothing is written when any spec is
// invalid.
func AddCells(p *Page, specs []CellSpec) ([]string, error) {
	if len(specs) == 0 {
		return nil, fmt.Errorf("name at least one cell to add")
	}
	m, err := parseModel(p.ModelXML())
	if err != nil {
		return nil, err
	}
	ensureRootLayer(m)
	known := idSet(m)
	ids := make([]string, 0, len(specs))
	nodes := make([]xmlNode, 0, len(specs))
	for _, spec := range specs {
		node, id, err := buildCellNode(spec, known)
		if err != nil {
			return nil, err
		}
		known[id] = true
		ids = append(ids, id)
		nodes = append(nodes, node)
	}
	m.Root.Children = append(m.Root.Children, nodes...)
	return ids, writeModel(p, m)
}

func buildCellNode(spec CellSpec, known map[string]bool) (xmlNode, string, error) {
	switch spec.Kind {
	case KindVertex, KindEdge:
	default:
		return xmlNode{}, "", fmt.Errorf("cell kind must be %q or %q, not %q", KindVertex, KindEdge, spec.Kind)
	}
	id := spec.ID
	if id == "" {
		for id = MintCellID(); known[id]; id = MintCellID() {
		}
	} else if known[id] {
		return xmlNode{}, "", fmt.Errorf("a cell with id %q is already on this page -- pick another id, or omit id and Mill mints one", id)
	}
	if spec.Kind == KindEdge {
		for _, end := range []struct{ name, id string }{{"source", spec.Source}, {"target", spec.Target}} {
			if end.id == "" {
				return xmlNode{}, "", fmt.Errorf("an edge needs both source and target cell ids (%s is missing)", end.name)
			}
			if !known[end.id] {
				return xmlNode{}, "", fmt.Errorf("no cell with id %q on this page to use as the edge's %s", end.id, end.name)
			}
		}
	}
	return xmlNode{XMLName: xml.Name{Local: "mxCell"}, Attrs: cellAttrs(spec, id), Inner: cellGeometryXML(spec)}, id, nil
}

func cellAttrs(spec CellSpec, id string) []xml.Attr {
	parent := spec.Parent
	if parent == "" {
		parent = RootLayerID
	}
	style := spec.Style
	attrs := []xml.Attr{{Name: xml.Name{Local: "id"}, Value: id}}
	if spec.Label != "" {
		attrs = append(attrs, xml.Attr{Name: xml.Name{Local: "value"}, Value: spec.Label})
	}
	if spec.Kind == KindEdge {
		if style == "" {
			style = DefaultEdgeStyle
		}
		attrs = append(attrs,
			xml.Attr{Name: xml.Name{Local: "style"}, Value: style},
			xml.Attr{Name: xml.Name{Local: "edge"}, Value: "1"},
			xml.Attr{Name: xml.Name{Local: "parent"}, Value: parent},
			xml.Attr{Name: xml.Name{Local: "source"}, Value: spec.Source},
			xml.Attr{Name: xml.Name{Local: "target"}, Value: spec.Target})
		return attrs
	}
	if style == "" {
		style = DefaultVertexStyle
	}
	return append(attrs,
		xml.Attr{Name: xml.Name{Local: "style"}, Value: style},
		xml.Attr{Name: xml.Name{Local: "vertex"}, Value: "1"},
		xml.Attr{Name: xml.Name{Local: "parent"}, Value: parent})
}

func cellGeometryXML(spec CellSpec) string {
	if spec.Kind == KindEdge {
		return `<mxGeometry relative="1" as="geometry"/>`
	}
	g := GeometryOut{X: ptr(defaultVertexX), Y: ptr(defaultVertexY), W: ptr(defaultVertexWidth), H: ptr(defaultVertexHeight)}
	if spec.Geometry != nil {
		mergeGeometry(&g, spec.Geometry)
	}
	return fmt.Sprintf(`<mxGeometry x="%s" y="%s" width="%s" height="%s" as="geometry"/>`,
		formatCoord(*g.X), formatCoord(*g.Y), formatCoord(*g.W), formatCoord(*g.H))
}

func ptr(v float64) *float64 { return &v }

func mergeGeometry(into *GeometryOut, from *GeometryOut) {
	if from.X != nil {
		into.X = from.X
	}
	if from.Y != nil {
		into.Y = from.Y
	}
	if from.W != nil {
		into.W = from.W
	}
	if from.H != nil {
		into.H = from.H
	}
}

func formatCoord(v float64) string { return strconv.FormatFloat(v, 'f', -1, 64) }

// EditCells applies each patch to the cell it names. An unknown id
// fails the whole call before anything is written -- a partially
// applied batch is never a state an approver agreed to.
func EditCells(p *Page, patches []CellPatch) (int, error) {
	if len(patches) == 0 {
		return 0, fmt.Errorf("name at least one cell to edit")
	}
	m, err := parseModel(p.ModelXML())
	if err != nil {
		return 0, err
	}
	index := make(map[string]int, len(m.Root.Children))
	for i := range m.Root.Children {
		index[m.Root.Children[i].id()] = i
	}
	for _, patch := range patches {
		if _, ok := index[patch.ID]; !ok {
			return 0, fmt.Errorf("no cell with id %q on this page", patch.ID)
		}
	}
	for _, patch := range patches {
		if err := applyPatch(&m.Root.Children[index[patch.ID]], patch); err != nil {
			return 0, err
		}
	}
	return len(patches), writeModel(p, m)
}

func applyPatch(n *xmlNode, patch CellPatch) error {
	if !n.isWrapper() {
		if patch.Label != "" || patch.ClearLabel {
			setAttr(&n.Attrs, "value", patch.newLabel())
		}
		return patchCell(n, patch)
	}
	if patch.Label != "" || patch.ClearLabel {
		setAttr(&n.Attrs, "label", patch.newLabel())
	}
	inner, ok := n.innerCell()
	if !ok {
		return fmt.Errorf("cell %q has no editable shape inside it", n.id())
	}
	if err := patchCell(&inner, patch); err != nil {
		return err
	}
	data, err := xml.Marshal(inner)
	if err != nil {
		return fmt.Errorf("write cell %q: %w", n.id(), err)
	}
	n.Inner = string(data)
	return nil
}

func patchCell(cell *xmlNode, patch CellPatch) error {
	for _, f := range []struct{ name, value string }{
		{"style", patch.Style}, {"parent", patch.Parent},
		{"source", patch.Source}, {"target", patch.Target},
	} {
		if f.value != "" {
			setAttr(&cell.Attrs, f.name, f.value)
		}
	}
	if patch.Geometry == nil {
		return nil
	}
	return patchGeometry(cell, patch.Geometry)
}

// patchGeometry merges the named coordinates into the cell's existing
// <mxGeometry>, leaving its other children (waypoint arrays, exit/entry
// points) exactly where they were.
func patchGeometry(cell *xmlNode, g *GeometryOut) error {
	var wrap struct {
		Children []xmlNode `xml:",any"`
	}
	if cell.Inner != "" {
		if err := xml.Unmarshal([]byte("<w>"+cell.Inner+"</w>"), &wrap); err != nil {
			return fmt.Errorf("read cell %q geometry: %w", cell.id(), err)
		}
	}
	found := false
	for i := range wrap.Children {
		if wrap.Children[i].XMLName.Local != "mxGeometry" {
			continue
		}
		setGeometryAttrs(&wrap.Children[i].Attrs, g)
		found = true
		break
	}
	if !found {
		geom := xmlNode{XMLName: xml.Name{Local: "mxGeometry"}, Attrs: []xml.Attr{{Name: xml.Name{Local: "as"}, Value: "geometry"}}}
		setGeometryAttrs(&geom.Attrs, g)
		wrap.Children = append(wrap.Children, geom)
	}
	var b strings.Builder
	for _, c := range wrap.Children {
		data, err := xml.Marshal(c)
		if err != nil {
			return fmt.Errorf("write cell %q geometry: %w", cell.id(), err)
		}
		b.Write(data)
	}
	cell.Inner = b.String()
	return nil
}

func setGeometryAttrs(attrs *[]xml.Attr, g *GeometryOut) {
	for _, f := range []struct {
		name string
		v    *float64
	}{{"x", g.X}, {"y", g.Y}, {"width", g.W}, {"height", g.H}} {
		if f.v != nil {
			setAttr(attrs, f.name, formatCoord(*f.v))
		}
	}
}

func setAttr(attrs *[]xml.Attr, name, value string) {
	for i := range *attrs {
		if (*attrs)[i].Name.Local == name {
			(*attrs)[i].Value = value
			return
		}
	}
	*attrs = append(*attrs, xml.Attr{Name: xml.Name{Local: name}, Value: value})
}

// DeleteCells removes the named cells and every edge left dangling by
// their removal, reporting both lists separately so an approver sees
// the full blast radius. The model root and the default layer are
// never deletable.
func DeleteCells(p *Page, ids []string) (deleted, edgesRemoved []string, err error) {
	if len(ids) == 0 {
		return nil, nil, fmt.Errorf("name at least one cell to delete")
	}
	m, err := parseModel(p.ModelXML())
	if err != nil {
		return nil, nil, err
	}
	present := idSet(m)
	target := make(map[string]bool, len(ids))
	for _, id := range ids {
		if id == RootCellID || id == RootLayerID {
			return nil, nil, fmt.Errorf("cell %q is part of every diagram's structure and cannot be deleted", id)
		}
		if !present[id] {
			return nil, nil, fmt.Errorf("no cell with id %q on this page", id)
		}
		target[id] = true
	}

	kept := make([]xmlNode, 0, len(m.Root.Children))
	deleted, edgesRemoved = []string{}, []string{}
	for _, n := range m.Root.Children {
		id := n.id()
		if target[id] {
			deleted = append(deleted, id)
			continue
		}
		cell, _ := n.innerCell()
		if cellKind(cell) == KindEdge &&
			(target[attrValue(cell.Attrs, "source")] || target[attrValue(cell.Attrs, "target")]) {
			edgesRemoved = append(edgesRemoved, id)
			continue
		}
		kept = append(kept, n)
	}
	m.Root.Children = kept
	return deleted, edgesRemoved, writeModel(p, m)
}

func idSet(m *xmlModel) map[string]bool {
	out := make(map[string]bool, len(m.Root.Children))
	for i := range m.Root.Children {
		if id := m.Root.Children[i].id(); id != "" {
			out[id] = true
		}
	}
	return out
}

// ensureRootLayer gives an empty model mxGraph's two mandatory cells,
// so the very first added cell has a layer to belong to.
func ensureRootLayer(m *xmlModel) {
	known := idSet(m)
	if known[RootCellID] && known[RootLayerID] {
		return
	}
	var seed []xmlNode
	if !known[RootCellID] {
		seed = append(seed, xmlNode{XMLName: xml.Name{Local: "mxCell"}, Attrs: []xml.Attr{{Name: xml.Name{Local: "id"}, Value: RootCellID}}})
	}
	if !known[RootLayerID] {
		seed = append(seed, xmlNode{XMLName: xml.Name{Local: "mxCell"},
			Attrs: []xml.Attr{{Name: xml.Name{Local: "id"}, Value: RootLayerID}, {Name: xml.Name{Local: "parent"}, Value: RootCellID}}})
	}
	m.Root.Children = append(seed, m.Root.Children...)
}

func writeModel(p *Page, m *xmlModel) error {
	out, err := m.marshal()
	if err != nil {
		return err
	}
	p.SetModelXML(out)
	return nil
}
