package drawio

import (
	"encoding/xml"
	"fmt"
	"strings"
)

// Import with an explicit mode (goal 0323): the whole-file replace path
// exists BESIDE the incremental one, never as the only one. "add"
// merges an incoming fragment into a page keeping both sides' cells;
// "new-page" files the incoming diagram as its own page; "replace"
// overwrites the file, the one mode a format without stable cell ids
// (Mermaid) can honestly offer.

type ImportMode string

const (
	ImportReplace ImportMode = "replace"
	ImportAdd     ImportMode = "add"
	ImportNewPage ImportMode = "new-page"
)

// ImportResult reports what an import actually did.
type ImportResult struct {
	Mode string `json:"mode"`
	// Added counts the cells merged or filed by this import.
	Added int `json:"added"`
	// Pages names the pages this import created, if any.
	Pages []PageOut `json:"pages,omitempty"`
	// Remapped maps an incoming cell id that collided with one already
	// on the page to the id it landed under instead.
	Remapped map[string]string `json:"remapped,omitempty"`
}

// NormalizeSource accepts draw.io content in any of its three wire
// forms and returns the document text underneath it.
func NormalizeSource(content string) (string, error) {
	trimmed := StripXMLDeclaration(content)
	if trimmed == "" {
		return "", fmt.Errorf("the diagram content is empty")
	}
	if strings.HasPrefix(trimmed, "<mxfile") || strings.HasPrefix(trimmed, "<mxGraphModel") {
		return trimmed, nil
	}
	if decoded, ok := uriDecode(trimmed); ok {
		if inner := strings.TrimSpace(decoded); strings.HasPrefix(inner, "<mxfile") || strings.HasPrefix(inner, "<mxGraphModel") {
			return inner, nil
		}
	}
	if inflated, ok := InflateWireText(trimmed); ok {
		if inner := strings.TrimSpace(inflated); strings.HasPrefix(inner, "<mxfile") || strings.HasPrefix(inner, "<mxGraphModel") {
			return inner, nil
		}
	}
	return "", fmt.Errorf("this content is not a draw.io diagram (expected diagram XML, or its URI-encoded or compressed form)")
}

// ImportInto merges content into d under mode. "replace" is handled by
// the caller (it rewrites the whole file rather than editing this
// document), so only "add" and "new-page" reach here.
func ImportInto(d *Document, targetPageID, content string, mode ImportMode, pageName string) (ImportResult, error) {
	source, err := NormalizeSource(content)
	if err != nil {
		return ImportResult{}, err
	}
	incoming, err := ParseDocument(source)
	if err != nil {
		return ImportResult{}, err
	}
	switch mode {
	case ImportAdd:
		return importAdd(d, targetPageID, incoming)
	case ImportNewPage:
		return importNewPage(d, incoming, pageName)
	}
	return ImportResult{}, fmt.Errorf("import mode must be %q, %q or %q", ImportReplace, ImportAdd, ImportNewPage)
}

func importAdd(d *Document, targetPageID string, incoming *Document) (ImportResult, error) {
	target, err := d.Page(targetPageID)
	if err != nil {
		return ImportResult{}, err
	}
	m, err := parseModel(target.ModelXML())
	if err != nil {
		return ImportResult{}, err
	}
	ensureRootLayer(m)
	known := idSet(m)
	remapped := map[string]string{}
	var merged []xmlNode
	for _, p := range incoming.Pages() {
		nodes, err := graphNodes(p)
		if err != nil {
			return ImportResult{}, err
		}
		merged = append(merged, reidentify(nodes, known, remapped)...)
	}
	rewriteReferences(merged, remapped, known)
	m.Root.Children = append(m.Root.Children, merged...)
	if err := writeModel(target, m); err != nil {
		return ImportResult{}, err
	}
	return ImportResult{Mode: string(ImportAdd), Added: len(merged), Remapped: remapped}, nil
}

// reidentify gives every incoming cell an id free on the target page,
// recording each collision it had to resolve so the caller can report
// the map rather than leaving an agent guessing which id it got.
func reidentify(nodes []xmlNode, known map[string]bool, remapped map[string]string) []xmlNode {
	for i := range nodes {
		id := nodes[i].id()
		newID := id
		if id == "" || known[id] {
			newID = freeID(known)
			if id != "" {
				remapped[id] = newID
			}
		}
		known[newID] = true
		setAttr(&nodes[i].Attrs, "id", newID)
	}
	return nodes
}

func freeID(known map[string]bool) string {
	id := MintCellID()
	for known[id] {
		id = MintCellID()
	}
	return id
}

// rewriteReferences points every merged cell's parent/source/target at
// the id it actually landed under, and re-homes a reference to a cell
// that did not come along (an incoming layer, say) onto the page's own
// default layer so nothing arrives orphaned.
func rewriteReferences(nodes []xmlNode, remapped map[string]string, known map[string]bool) {
	for i := range nodes {
		if !nodes[i].isWrapper() {
			rewriteCellReferences(&nodes[i], remapped, known)
			continue
		}
		inner, ok := nodes[i].innerCell()
		if !ok {
			continue
		}
		rewriteCellReferences(&inner, remapped, known)
		if data, err := xml.Marshal(inner); err == nil {
			nodes[i].Inner = string(data)
		}
	}
}

func rewriteCellReferences(cell *xmlNode, remapped map[string]string, known map[string]bool) {
	for _, ref := range []string{"parent", "source", "target"} {
		old := attrValue(cell.Attrs, ref)
		switch {
		case old == "":
		case remapped[old] != "":
			setAttr(&cell.Attrs, ref, remapped[old])
		case !known[old]:
			setAttr(&cell.Attrs, ref, RootLayerID)
		}
	}
}

func importNewPage(d *Document, incoming *Document, pageName string) (ImportResult, error) {
	if d.rootName != "mxfile" {
		return ImportResult{}, fmt.Errorf("this diagram has no page structure to add a page to -- import it with mode \"replace\" instead")
	}
	form := d.pages[len(d.pages)-1].Form()
	if form == WireOpaque {
		form = WireInline
	}
	taken := map[string]bool{}
	for _, p := range d.Pages() {
		taken[p.ID()] = true
	}
	result := ImportResult{Mode: string(ImportNewPage)}
	for i, src := range incoming.Pages() {
		name := PageName(src.Name(), len(d.Pages()))
		if i == 0 && pageName != "" {
			name = pageName
		}
		added, err := appendImportedPage(d, src, name, form, taken)
		if err != nil {
			return ImportResult{}, err
		}
		result.Added += added
		result.Pages = append(result.Pages, PageOut{ID: d.pages[len(d.pages)-1].ID(), Name: name})
	}
	if len(result.Pages) == 0 {
		return ImportResult{}, fmt.Errorf("the imported diagram has no pages")
	}
	return result, nil
}

func appendImportedPage(d *Document, src *Page, name string, form WireForm, taken map[string]bool) (int, error) {
	model := src.ModelXML()
	if strings.TrimSpace(model) == "" {
		return 0, fmt.Errorf("page %q of the imported diagram is stored in a format Mill cannot read", name)
	}
	nodes, err := graphNodes(src)
	if err != nil {
		return 0, err
	}
	id := src.ID()
	if id == "" || taken[id] {
		id = freeID(taken)
	}
	taken[id] = true
	d.AppendPage(id, name, model, form)
	return len(nodes), nil
}

// graphNodes are a page's vertex/edge cells -- everything except the
// model root and the layer cells, which the target page already has
// its own copies of.
func graphNodes(p *Page) ([]xmlNode, error) {
	m, err := parseModel(p.ModelXML())
	if err != nil {
		return nil, err
	}
	out := make([]xmlNode, 0, len(m.Root.Children))
	for _, n := range m.Root.Children {
		cell, _ := n.innerCell()
		if cellKind(cell) == "" {
			continue
		}
		out = append(out, n)
	}
	return out, nil
}
