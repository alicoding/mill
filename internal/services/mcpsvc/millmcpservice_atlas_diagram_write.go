package mcpsvc

import (
	"encoding/json"
	"fmt"

	"github.com/alicoding/mill/internal/domain/atlas/drawio"
)

// The four in-place diagram writes (goal 0323). Each one parks through
// the shared gateWrite/registerWriteExecutor pair every other write
// tool in this package uses -- never a second approval path -- and each
// one rewrites ONLY the cells it names: the other cells, the other
// layers and the other pages of the file come back out unchanged.
//
// The approval prompt is written in the person's words ("Add 3 shapes
// to Architecture.drawio"), never a tool name or an id, so what is
// being approved is legible from the banner alone.

// approvalPollNote is the shared tail every gated diagram tool's
// description carries -- one statement of the toggle and the poll
// contract, so the four descriptions stay about what the tool DOES.
const approvalPollNote = "Requires the human-set 'Allow MCP clients to import data' toggle in Mill's Settings " +
	"(default off); may park pending human approval -- poll check_write_status with the returned id. Parks for approval."

type atlasDiagramAddArgs struct {
	ObjectID string            `json:"objectId" jsonschema:"the diagram board object's id (from atlas_read_board_objects)"`
	PageID   string            `json:"pageId,omitempty" jsonschema:"optional: which page to add to, by its id or name. Defaults to the first page."`
	Cells    []drawio.CellSpec `json:"cells" jsonschema:"the shapes and connectors to add"`
}

type atlasDiagramAddResult struct {
	IDs []string `json:"ids"`
}

type atlasDiagramEditArgs struct {
	ObjectID string             `json:"objectId" jsonschema:"the diagram board object's id"`
	PageID   string             `json:"pageId,omitempty" jsonschema:"optional: which page the cells are on, by its id or name. Defaults to the first page."`
	Patches  []drawio.CellPatch `json:"patches" jsonschema:"one entry per cell to change, each naming the cell's id and only the parts to change"`
}

type atlasDiagramEditResult struct {
	Updated int `json:"updated"`
}

type atlasDiagramDeleteArgs struct {
	ObjectID string   `json:"objectId" jsonschema:"the diagram board object's id"`
	PageID   string   `json:"pageId,omitempty" jsonschema:"optional: which page the cells are on, by its id or name. Defaults to the first page."`
	IDs      []string `json:"ids" jsonschema:"the cell ids to delete (from atlas_read_diagram)"`
}

type atlasDiagramDeleteResult struct {
	Deleted      []string `json:"deleted"`
	EdgesRemoved []string `json:"edgesRemoved"`
}

type atlasDiagramImportArgs struct {
	ObjectID string `json:"objectId" jsonschema:"the diagram board object's id"`
	Content  string `json:"content" jsonschema:"the diagram to bring in: draw.io XML (plain, URI-encoded or compressed), or Mermaid text for a Mermaid diagram"`
	Mode     string `json:"mode" jsonschema:"replace (overwrite the whole file), add (merge the incoming cells into a page, re-minting any id that collides) or new-page (file the incoming diagram as its own page)"`
	PageID   string `json:"pageId,omitempty" jsonschema:"optional, mode=add only: which page to merge into. Defaults to the first page."`
	PageName string `json:"pageName,omitempty" jsonschema:"optional, mode=new-page only: the new page's name"`
}

// requireDiagramWrite runs every check that can be answered without
// touching the file's cells, BEFORE the write parks: writes enabled,
// Atlas wired, the object a real, readable draw.io diagram. A call
// that could never succeed must never reach a person's approval queue.
func (m *MillMCPService) requireDiagramWrite(objectID string) (resolvedDiagram, error) {
	if err := m.requireWriteEnabled(); err != nil {
		return resolvedDiagram{}, err
	}
	if err := m.requireAtlas(); err != nil {
		return resolvedDiagram{}, err
	}
	r, err := m.resolveDiagram(objectID)
	if err != nil {
		return resolvedDiagram{}, err
	}
	if r.format != diagramFormatDrawio {
		return resolvedDiagram{}, fmt.Errorf("%q is a Mermaid diagram: Mermaid has no cell ids, so edit it with atlas_diagram_import in \"replace\" mode instead", r.title)
	}
	return r, nil
}

// editDiagramDocument is the one write path every diagram executor
// runs through: read the file, apply fn to the parsed document, write
// the whole file back through the SAME mirror door the embedded editor
// saves through. Nothing is written when fn fails.
func (m *MillMCPService) editDiagramDocument(objectID string, fn func(*drawio.Document) (any, error)) (string, error) {
	r, err := m.resolveDiagram(objectID)
	if err != nil {
		return "", err
	}
	doc, err := r.document()
	if err != nil {
		return "", err
	}
	out, err := fn(doc)
	if err != nil {
		return "", err
	}
	rewritten, err := doc.Marshal()
	if err != nil {
		return "", err
	}
	if err := m.atlas.WriteObjectMirror(objectID, rewritten); err != nil {
		return "", err
	}
	return jsonText(out)
}

func (m *MillMCPService) executeDiagramAdd(argsJSON string) (string, error) {
	var in atlasDiagramAddArgs
	if err := json.Unmarshal([]byte(argsJSON), &in); err != nil {
		return "", err
	}
	return m.editDiagramDocument(in.ObjectID, func(doc *drawio.Document) (any, error) {
		page, err := doc.Page(in.PageID)
		if err != nil {
			return nil, err
		}
		ids, err := drawio.AddCells(page, in.Cells)
		if err != nil {
			return nil, err
		}
		return atlasDiagramAddResult{IDs: ids}, nil
	})
}

func (m *MillMCPService) executeDiagramEdit(argsJSON string) (string, error) {
	var in atlasDiagramEditArgs
	if err := json.Unmarshal([]byte(argsJSON), &in); err != nil {
		return "", err
	}
	return m.editDiagramDocument(in.ObjectID, func(doc *drawio.Document) (any, error) {
		page, err := doc.Page(in.PageID)
		if err != nil {
			return nil, err
		}
		updated, err := drawio.EditCells(page, in.Patches)
		if err != nil {
			return nil, err
		}
		return atlasDiagramEditResult{Updated: updated}, nil
	})
}

func (m *MillMCPService) executeDiagramDelete(argsJSON string) (string, error) {
	var in atlasDiagramDeleteArgs
	if err := json.Unmarshal([]byte(argsJSON), &in); err != nil {
		return "", err
	}
	return m.editDiagramDocument(in.ObjectID, func(doc *drawio.Document) (any, error) {
		page, err := doc.Page(in.PageID)
		if err != nil {
			return nil, err
		}
		deleted, edges, err := drawio.DeleteCells(page, in.IDs)
		if err != nil {
			return nil, err
		}
		return atlasDiagramDeleteResult{Deleted: deleted, EdgesRemoved: edges}, nil
	})
}

// executeDiagramImport splits on mode: "replace" is a whole-file write
// (the only mode a format without cell ids can offer), the other two
// edit the parsed document in place.
func (m *MillMCPService) executeDiagramImport(argsJSON string) (string, error) {
	var in atlasDiagramImportArgs
	if err := json.Unmarshal([]byte(argsJSON), &in); err != nil {
		return "", err
	}
	if drawio.ImportMode(in.Mode) == drawio.ImportReplace {
		return m.executeDiagramReplace(in)
	}
	return m.editDiagramDocument(in.ObjectID, func(doc *drawio.Document) (any, error) {
		return drawio.ImportInto(doc, in.PageID, in.Content, drawio.ImportMode(in.Mode), in.PageName)
	})
}

func (m *MillMCPService) executeDiagramReplace(in atlasDiagramImportArgs) (string, error) {
	r, err := m.resolveDiagram(in.ObjectID)
	if err != nil {
		return "", err
	}
	content := in.Content
	if r.format == diagramFormatDrawio {
		// A replace still has to BE a diagram: writing arbitrary text
		// over a .drawio file is corruption, not an import.
		if content, err = drawio.NormalizeSource(in.Content); err != nil {
			return "", err
		}
	}
	if err := m.atlas.WriteObjectMirror(in.ObjectID, content); err != nil {
		return "", err
	}
	return jsonText(drawio.ImportResult{Mode: string(drawio.ImportReplace)})
}

// importDescription is the approval prompt for each mode, in the
// person's words.
func importDescription(mode, title, pageName string) string {
	switch drawio.ImportMode(mode) {
	case drawio.ImportReplace:
		return fmt.Sprintf("Replace everything in %s with an imported diagram", title)
	case drawio.ImportAdd:
		return fmt.Sprintf("Merge an imported diagram into %s", title)
	case drawio.ImportNewPage:
		if pageName != "" {
			return fmt.Sprintf("Add a page %q to %s from an imported diagram", pageName, title)
		}
		return fmt.Sprintf("Add a page to %s from an imported diagram", title)
	}
	return fmt.Sprintf("Import a diagram into %s", title)
}

func pluralCells(n int) string {
	if n == 1 {
		return "1 cell"
	}
	return fmt.Sprintf("%d cells", n)
}
