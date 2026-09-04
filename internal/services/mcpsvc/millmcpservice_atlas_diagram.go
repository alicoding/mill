package mcpsvc

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/domain/atlas/drawio"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Diagrams as a programmable content plane (goal 0323, ADR-0046): a
// diagram board object's own FILE is the content, so an agent reads
// its cells by id and edits them in place -- the incremental verbs the
// whole ecosystem converged on -- instead of regenerating the file and
// destroying every id, layer and page the person already arranged.
// The read half lives here; the four gated write tools live in
// millmcpservice_atlas_diagram_write.go, and every one of them goes
// through the SAME requireWriteEnabled + gateWrite park this package's
// other write tools use.
//
// Reads come through AtlasService.ObjectMirrorContent and writes
// through AtlasService.WriteObjectMirror -- the exact doors the
// embedded editor already uses, so an open editor and the board face
// refresh through the one existing mirror watch rather than a second
// signal.

// diagramFormatDrawio/diagramFormatMermaid are the two diagram sources
// a "diagram" board object can be backed by. Only draw.io has stable
// per-cell ids, which is why only it gets the incremental verbs.
const (
	diagramFormatDrawio  = "drawio"
	diagramFormatMermaid = "mermaid"
)

// resolvedDiagram is one diagram object's identity plus its file's
// current text -- everything a read or a write needs after the
// fail-closed checks below have passed.
type resolvedDiagram struct {
	object atlas.BoardObject
	title  string
	format string
	text   string
}

// resolveDiagram fails closed on everything that is not a readable
// diagram source: a missing object, a board object of another kind, a
// binary spreadsheet or any other non-diagram mirror, a vanished file,
// and a file too large to read. The error always names what was found
// so an agent can correct itself rather than retrying blind.
func (m *MillMCPService) resolveDiagram(objectID string) (resolvedDiagram, error) {
	o, err := m.findBoardObject(objectID)
	if err != nil {
		return resolvedDiagram{}, err
	}
	if o.Kind != "diagram" {
		return resolvedDiagram{}, fmt.Errorf("board object %q is a %q, not a diagram -- these tools only edit diagram objects", objectID, o.Kind)
	}
	path := o.Payload["mirrorPath"]
	if path == "" {
		return resolvedDiagram{}, fmt.Errorf("diagram %q has no file behind it to edit", objectID)
	}
	format, err := diagramFormatOf(path)
	if err != nil {
		return resolvedDiagram{}, err
	}
	mc, err := m.atlas.ObjectMirrorContent(o.ID)
	if err != nil {
		return resolvedDiagram{}, err
	}
	switch {
	case mc.Missing:
		return resolvedDiagram{}, fmt.Errorf("the file behind diagram %q is gone from disk", objectID)
	case mc.TooLarge:
		return resolvedDiagram{}, fmt.Errorf("the file behind diagram %q is too large to read", objectID)
	}
	return resolvedDiagram{object: o, title: diagramTitle(o, path), format: format, text: mc.Content}, nil
}

func diagramFormatOf(path string) (string, error) {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".drawio":
		return diagramFormatDrawio, nil
	case ".mmd", ".mermaid":
		return diagramFormatMermaid, nil
	}
	return "", fmt.Errorf("%q is not a diagram source Mill can edit (draw.io and Mermaid files only)", filepath.Base(path))
}

// diagramTitle is what an approval prompt names: the object's own
// title when it has one, otherwise the file's name -- never an
// opaque id.
func diagramTitle(o atlas.BoardObject, path string) string {
	if t := o.Payload["title"]; t != "" {
		return t
	}
	return filepath.Base(path)
}

// document parses the resolved file. Mermaid has no document model at
// all, so it never reaches here.
func (r resolvedDiagram) document() (*drawio.Document, error) {
	return drawio.ParseDocument(r.text)
}

// --- atlas_read_diagram ---

type atlasReadDiagramArgs struct {
	ObjectID string `json:"objectId" jsonschema:"the diagram board object's id (from atlas_read_board_objects)"`
	PageID   string `json:"pageId,omitempty" jsonschema:"optional: which page to read, by its id or name. Defaults to the first page."`
}

type atlasReadDiagramResult struct {
	Format     string            `json:"format"`
	Pages      []drawio.PageOut  `json:"pages,omitempty"`
	ActivePage string            `json:"activePage,omitempty"`
	Layers     []drawio.LayerOut `json:"layers,omitempty"`
	Cells      []drawio.CellOut  `json:"cells,omitempty"`
	Text       string            `json:"text,omitempty"`
}

func (m *MillMCPService) readDiagram(in atlasReadDiagramArgs) (atlasReadDiagramResult, error) {
	r, err := m.resolveDiagram(in.ObjectID)
	if err != nil {
		return atlasReadDiagramResult{}, err
	}
	if r.format == diagramFormatMermaid {
		return atlasReadDiagramResult{Format: diagramFormatMermaid, Text: r.text}, nil
	}
	doc, err := r.document()
	if err != nil {
		return atlasReadDiagramResult{}, err
	}
	page, err := doc.Page(in.PageID)
	if err != nil {
		return atlasReadDiagramResult{}, err
	}
	layers, cells, err := drawio.ReadPage(page)
	if err != nil {
		return atlasReadDiagramResult{}, err
	}
	pages := drawio.PagesOf(doc)
	active := page.ID()
	if active == "" {
		active = page.Name()
	}
	return atlasReadDiagramResult{
		Format: diagramFormatDrawio, Pages: pages, ActivePage: active,
		Layers: layers, Cells: cells,
	}, nil
}

// registerAtlasDiagramTools wires the read tool plus the four gated
// write tools -- called from registerAtlasTools (millmcpservice_atlas.go).
func (m *MillMCPService) registerAtlasDiagramTools() {
	mcp.AddTool(m.server, &mcp.Tool{
		Name: "atlas_read_diagram",
		Description: "One diagram board object's own cells, by id -- the ids every edit, delete and connect " +
			"takes. Returns the file's pages, the layers on the requested page, and each vertex (shape) or " +
			"edge (connector) with its id, label, style, parent, endpoints and geometry. A Mermaid diagram " +
			"has no cell ids, so it returns its source text instead. Read this before writing anything: an " +
			"edit names cells by the ids reported here. Read-only.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in atlasReadDiagramArgs) (*mcp.CallToolResult, any, error) {
		if err := m.requireAtlas(); err != nil {
			return nil, nil, err
		}
		out, err := m.readDiagram(in)
		if err != nil {
			return nil, nil, err
		}
		res, err := jsonResult(out)
		return res, nil, err
	})

	m.registerAtlasDiagramWriteTools()
	m.registerAtlasCreateObjectTool()
}
