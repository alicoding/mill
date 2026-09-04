package mcpsvc

import (
	"context"
	"fmt"

	"github.com/alicoding/mill/internal/domain/atlas/drawio"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Registration for the four in-place diagram writes -- kept apart from
// their executors (millmcpservice_atlas_diagram_write.go) the same way
// this package already splits the atlas write family, so each file
// stays about one thing.

func (m *MillMCPService) registerAtlasDiagramWriteTools() {
	m.registerAtlasDiagramAddTool()
	m.registerAtlasDiagramEditTool()
	m.registerAtlasDiagramDeleteTool()
	m.registerAtlasDiagramImportTool()
}

func (m *MillMCPService) registerAtlasDiagramAddTool() {
	m.registerWriteExecutor("atlas_diagram_add_cells", m.executeDiagramAdd)
	mcp.AddTool(m.server, &mcp.Tool{
		Name: "atlas_diagram_add_cells",
		Description: "Add shapes and connectors to a diagram without touching anything already on it. Each " +
			"cell may carry its own id (unique on the page) or let Mill mint one; a connector names the " +
			"source and target cell ids it joins, which must already exist. Returns the ids the new cells " +
			"landed under, in the order given. " + approvalPollNote,
	}, func(_ context.Context, _ *mcp.CallToolRequest, in atlasDiagramAddArgs) (*mcp.CallToolResult, any, error) {
		r, err := m.requireDiagramWrite(in.ObjectID)
		if err != nil {
			return nil, nil, err
		}
		if len(in.Cells) == 0 {
			return nil, nil, fmt.Errorf("name at least one cell to add")
		}
		argsJSON, err := marshalArgs(in)
		if err != nil {
			return nil, nil, err
		}
		res, err := m.gateWrite("atlas_diagram_add_cells", addCellsDescription(in.Cells, r.title), argsJSON)
		return res, nil, err
	})
}

func (m *MillMCPService) registerAtlasDiagramEditTool() {
	m.registerWriteExecutor("atlas_diagram_edit_cells", m.executeDiagramEdit)
	mcp.AddTool(m.server, &mcp.Tool{
		Name: "atlas_diagram_edit_cells",
		Description: "Change cells a diagram already has, by id -- rename one, restyle it, move or resize it, " +
			"re-home it into another layer, or reconnect a connector's ends. Only the parts you name change; " +
			"geometry merges coordinate by coordinate. An id that isn't on the page fails the whole call " +
			"before anything is written. " + approvalPollNote,
	}, func(_ context.Context, _ *mcp.CallToolRequest, in atlasDiagramEditArgs) (*mcp.CallToolResult, any, error) {
		r, err := m.requireDiagramWrite(in.ObjectID)
		if err != nil {
			return nil, nil, err
		}
		if len(in.Patches) == 0 {
			return nil, nil, fmt.Errorf("name at least one cell to edit")
		}
		argsJSON, err := marshalArgs(in)
		if err != nil {
			return nil, nil, err
		}
		res, err := m.gateWrite("atlas_diagram_edit_cells",
			fmt.Sprintf("Edit %s in %s", pluralCells(len(in.Patches)), r.title), argsJSON)
		return res, nil, err
	})
}

func (m *MillMCPService) registerAtlasDiagramDeleteTool() {
	m.registerWriteExecutor("atlas_diagram_delete_cells", m.executeDiagramDelete)
	mcp.AddTool(m.server, &mcp.Tool{
		Name: "atlas_diagram_delete_cells",
		Description: "Remove cells from a diagram by id. Any connector left dangling by the removal goes " +
			"with them and is reported separately, so nothing is deleted silently. The diagram's own " +
			"structural cells (\"0\" and \"1\") can never be deleted. " + approvalPollNote,
	}, func(_ context.Context, _ *mcp.CallToolRequest, in atlasDiagramDeleteArgs) (*mcp.CallToolResult, any, error) {
		r, err := m.requireDiagramWrite(in.ObjectID)
		if err != nil {
			return nil, nil, err
		}
		if len(in.IDs) == 0 {
			return nil, nil, fmt.Errorf("name at least one cell to delete")
		}
		argsJSON, err := marshalArgs(in)
		if err != nil {
			return nil, nil, err
		}
		res, err := m.gateWrite("atlas_diagram_delete_cells",
			fmt.Sprintf("Delete %s from %s", pluralCells(len(in.IDs)), r.title), argsJSON)
		return res, nil, err
	})
}

func (m *MillMCPService) registerAtlasDiagramImportTool() {
	m.registerWriteExecutor("atlas_diagram_import", m.executeDiagramImport)
	mcp.AddTool(m.server, &mcp.Tool{
		Name: "atlas_diagram_import",
		Description: "Bring a whole diagram into an existing one: \"add\" merges its cells into a page and " +
			"re-mints any id that collides (reporting the map), \"new-page\" files it as its own page, and " +
			"\"replace\" overwrites the file outright. Prefer add or new-page -- replace discards every id, " +
			"layer and page already there. A Mermaid diagram accepts only replace. " + approvalPollNote,
	}, func(_ context.Context, _ *mcp.CallToolRequest, in atlasDiagramImportArgs) (*mcp.CallToolResult, any, error) {
		title, err := m.checkDiagramImport(in)
		if err != nil {
			return nil, nil, err
		}
		argsJSON, err := marshalArgs(in)
		if err != nil {
			return nil, nil, err
		}
		res, err := m.gateWrite("atlas_diagram_import", importDescription(in.Mode, title, in.PageName), argsJSON)
		return res, nil, err
	})
}

// checkDiagramImport is the import tool's own pre-park validation:
// unlike the other three it legitimately accepts a Mermaid object, but
// only in "replace" mode, so it can't reuse requireDiagramWrite whole.
func (m *MillMCPService) checkDiagramImport(in atlasDiagramImportArgs) (string, error) {
	if err := m.requireWriteEnabled(); err != nil {
		return "", err
	}
	if err := m.requireAtlas(); err != nil {
		return "", err
	}
	r, err := m.resolveDiagram(in.ObjectID)
	if err != nil {
		return "", err
	}
	mode := drawio.ImportMode(in.Mode)
	switch mode {
	case drawio.ImportReplace, drawio.ImportAdd, drawio.ImportNewPage:
	default:
		return "", fmt.Errorf("import mode must be %q, %q or %q, not %q",
			drawio.ImportReplace, drawio.ImportAdd, drawio.ImportNewPage, in.Mode)
	}
	if in.Content == "" {
		return "", fmt.Errorf("name the diagram content to import")
	}
	if r.format == diagramFormatMermaid && mode != drawio.ImportReplace {
		return "", fmt.Errorf("this diagram is Mermaid source: Mermaid has no cell ids; use replace")
	}
	if r.format == diagramFormatDrawio {
		if _, err := drawio.NormalizeSource(in.Content); err != nil {
			return "", err
		}
	}
	return r.title, nil
}

// addCellsDescription names what is being added in the person's own
// vocabulary -- shapes and connectors, never "vertices and edges".
func addCellsDescription(cells []drawio.CellSpec, title string) string {
	shapes, connectors := 0, 0
	for _, c := range cells {
		if c.Kind == drawio.KindEdge {
			connectors++
			continue
		}
		shapes++
	}
	switch {
	case connectors == 0:
		return fmt.Sprintf("Add %s to %s", countNoun(shapes, "shape"), title)
	case shapes == 0:
		return fmt.Sprintf("Add %s to %s", countNoun(connectors, "connector"), title)
	}
	return fmt.Sprintf("Add %s and %s to %s", countNoun(shapes, "shape"), countNoun(connectors, "connector"), title)
}

func countNoun(n int, noun string) string {
	if n == 1 {
		return "1 " + noun
	}
	return fmt.Sprintf("%d %ss", n, noun)
}
