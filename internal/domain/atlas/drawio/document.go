package drawio

import (
	"bytes"
	"compress/flate"
	"encoding/base64"
	"encoding/xml"
	"fmt"
	"strings"
)

// Document is a whole .drawio file held so that a page Mill never
// touched comes back out byte-identical (goal 0323's own rule): every
// page's inner content is captured verbatim via encoding/xml's
// ",innerxml", and only a page whose model is actually rewritten is
// re-encoded. The wrapper's own attributes ride through the same way,
// so host/agent/version/modified are never dropped.
type Document struct {
	decl     string
	attrs    []xml.Attr
	pages    []*Page
	rootName string
}

// WireForm is which of draw.io's three save shapes a page's content
// used -- a rewrite goes back out in the SAME form it came in.
type WireForm string

const (
	// WireInline: the page holds a real <mxGraphModel> child element.
	WireInline WireForm = "inline"
	// WireURI: the page holds URI-encoded model XML as its chardata.
	WireURI WireForm = "uri"
	// WireCompressed: base64 of a raw-deflate stream whose payload is
	// URI-encoded model XML -- draw.io's own default save shape.
	WireCompressed WireForm = "compressed"
	// WireOpaque: the content decoded as none of the above; it is
	// carried through untouched and can never be edited.
	WireOpaque WireForm = "opaque"
)

// Page is one <diagram> element.
type Page struct {
	attrs    []xml.Attr
	raw      string
	form     WireForm
	modelXML string
	dirty    bool
}

func (p *Page) ID() string   { return attrValue(p.attrs, "id") }
func (p *Page) Name() string { return attrValue(p.attrs, "name") }

// Form reports which wire shape this page was read in.
func (p *Page) Form() WireForm { return p.form }

// ModelXML is the page's decoded <mxGraphModel> XML; empty when the
// page is WireOpaque.
func (p *Page) ModelXML() string { return p.modelXML }

// SetModelXML replaces the page's model, marking it for re-encoding in
// its own wire form on the next Marshal.
func (p *Page) SetModelXML(model string) {
	p.modelXML = model
	p.dirty = true
}

// Pages returns the document's pages in file order.
func (d *Document) Pages() []*Page { return d.pages }

// Page finds a page by id, then by name; an empty id means the first
// page (draw.io's own "active page" default for a freshly opened file).
func (d *Document) Page(id string) (*Page, error) {
	if len(d.pages) == 0 {
		return nil, fmt.Errorf("this diagram has no pages")
	}
	if id == "" {
		return d.pages[0], nil
	}
	for _, p := range d.pages {
		if p.ID() == id {
			return p, nil
		}
	}
	for _, p := range d.pages {
		if p.Name() == id {
			return p, nil
		}
	}
	return nil, fmt.Errorf("no page with id or name %q in this diagram", id)
}

// AppendPage adds a new page carrying model, in form, and returns it.
func (d *Document) AppendPage(id, name, model string, form WireForm) *Page {
	p := &Page{
		attrs:    []xml.Attr{{Name: xml.Name{Local: "id"}, Value: id}, {Name: xml.Name{Local: "name"}, Value: name}},
		form:     form,
		modelXML: model,
		dirty:    true,
	}
	d.pages = append(d.pages, p)
	return p
}

// --- parse ---

type rawDiagram struct {
	XMLName xml.Name   `xml:"diagram"`
	Attrs   []xml.Attr `xml:",any,attr"`
	Inner   string     `xml:",innerxml"`
}

type rawFile struct {
	XMLName  xml.Name     `xml:"mxfile"`
	Attrs    []xml.Attr   `xml:",any,attr"`
	Diagrams []rawDiagram `xml:"diagram"`
}

// ParseDocument reads a .drawio file. A bare <mxGraphModel> (no mxfile
// wrapper -- what a clipboard payload or a hand-written fixture can
// be) is accepted too and presented as a single unnamed page, so every
// caller downstream sees one shape.
func ParseDocument(raw string) (*Document, error) {
	trimmed := strings.TrimSpace(raw)
	decl := ""
	if m := xmlDeclPattern.FindString(trimmed); m != "" {
		decl = m
		trimmed = trimmed[len(m):]
	}
	switch {
	case strings.HasPrefix(trimmed, "<mxfile"):
		return parseMxFileDocument(decl, trimmed)
	case strings.HasPrefix(trimmed, "<mxGraphModel"):
		d := &Document{decl: decl, rootName: "mxGraphModel"}
		d.pages = []*Page{{form: WireInline, modelXML: trimmed, raw: trimmed}}
		return d, nil
	default:
		return nil, fmt.Errorf("this file is not a draw.io diagram (expected an <mxfile> or <mxGraphModel> document)")
	}
}

func parseMxFileDocument(decl, trimmed string) (*Document, error) {
	var f rawFile
	if err := xml.Unmarshal([]byte(trimmed), &f); err != nil {
		return nil, fmt.Errorf("this file is not a readable draw.io diagram: %w", err)
	}
	d := &Document{decl: decl, attrs: f.Attrs, rootName: "mxfile"}
	for _, rd := range f.Diagrams {
		d.pages = append(d.pages, newPage(rd))
	}
	if len(d.pages) == 0 {
		return nil, fmt.Errorf("this diagram has no pages")
	}
	return d, nil
}

func newPage(rd rawDiagram) *Page {
	p := &Page{attrs: rd.Attrs, raw: rd.Inner, form: WireOpaque}
	inner := strings.TrimSpace(rd.Inner)
	switch {
	case strings.HasPrefix(inner, "<mxGraphModel"):
		p.form, p.modelXML = WireInline, inner
	case inner == "":
		// An empty page is inline-shaped by construction: anything
		// written into it becomes a real <mxGraphModel> child.
		p.form, p.modelXML = WireInline, ""
	default:
		decodeChardataPage(p, inner)
	}
	return p
}

func decodeChardataPage(p *Page, inner string) {
	if unescaped, ok := uriDecode(inner); ok && strings.HasPrefix(strings.TrimSpace(unescaped), "<mxGraphModel") {
		p.form, p.modelXML = WireURI, strings.TrimSpace(unescaped)
		return
	}
	if inflated, ok := InflateWireText(inner); ok && strings.HasPrefix(strings.TrimSpace(inflated), "<mxGraphModel") {
		p.form, p.modelXML = WireCompressed, strings.TrimSpace(inflated)
	}
}

// --- marshal ---

// Marshal rebuilds the file. Every page Mill did not rewrite is
// emitted from its captured raw bytes, so it survives unchanged.
func (d *Document) Marshal() (string, error) {
	if d.rootName == "mxGraphModel" {
		return d.decl + d.pages[0].modelXML, nil
	}
	var b strings.Builder
	b.WriteString(d.decl)
	b.WriteString("<mxfile")
	writeAttrs(&b, d.attrs)
	b.WriteString(">")
	for _, p := range d.pages {
		inner, err := p.encode()
		if err != nil {
			return "", err
		}
		b.WriteString("<diagram")
		writeAttrs(&b, p.attrs)
		b.WriteString(">")
		b.WriteString(inner)
		b.WriteString("</diagram>")
	}
	b.WriteString("</mxfile>")
	return b.String(), nil
}

func (p *Page) encode() (string, error) {
	if !p.dirty {
		return p.raw, nil
	}
	switch p.form {
	case WireInline:
		return p.modelXML, nil
	case WireURI:
		return escapeChardata(uriEncode(p.modelXML)), nil
	case WireCompressed:
		payload, err := deflateWireText(p.modelXML)
		if err != nil {
			return "", err
		}
		return escapeChardata(payload), nil
	case WireOpaque:
		return "", fmt.Errorf("page %q is stored in a format Mill cannot rewrite", PageName(p.Name(), 0))
	}
	return "", fmt.Errorf("page %q has an unknown storage format", PageName(p.Name(), 0))
}

// deflateWireText is InflateWireText's inverse: URI-encode, raw-deflate,
// base64 -- byte-for-byte the shape draw.io's own compressed save
// produces and reads back.
func deflateWireText(model string) (string, error) {
	var buf bytes.Buffer
	w, err := flate.NewWriter(&buf, flate.DefaultCompression)
	if err != nil {
		return "", fmt.Errorf("compress diagram page: %w", err)
	}
	if _, err := w.Write([]byte(uriEncode(model))); err != nil {
		return "", fmt.Errorf("compress diagram page: %w", err)
	}
	if err := w.Close(); err != nil {
		return "", fmt.Errorf("compress diagram page: %w", err)
	}
	return base64.StdEncoding.EncodeToString(buf.Bytes()), nil
}

func writeAttrs(b *strings.Builder, attrs []xml.Attr) {
	for _, a := range attrs {
		name := a.Name.Local
		if a.Name.Space != "" {
			name = a.Name.Space + ":" + name
		}
		b.WriteString(" ")
		b.WriteString(name)
		b.WriteString(`="`)
		b.WriteString(escapeChardata(a.Value))
		b.WriteString(`"`)
	}
}

func escapeChardata(s string) string {
	var buf bytes.Buffer
	if err := xml.EscapeText(&buf, []byte(s)); err != nil {
		return s
	}
	return buf.String()
}

func attrValue(attrs []xml.Attr, name string) string {
	for _, a := range attrs {
		if a.Name.Local == name {
			return a.Value
		}
	}
	return ""
}
