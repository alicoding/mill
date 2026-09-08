package mcpsvc

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/domain/atlas/sheet"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// A sheet board object as a programmable content plane (goal 0388),
// the same shape goal 0323 already proved for diagrams: the sheet
// object's own CSV file is the content, so an agent reads a range of
// its cells and edits named cells in place -- never a whole-file
// regenerate. The read half lives here; the one gated write tool
// lives in millmcpservice_atlas_sheet_write.go, through the SAME
// requireWriteEnabled + gateWrite park every other write tool in this
// package uses.
//
// Only a CSV-backed sheet is readable/editable this way -- a binary
// .xlsx sheet's bytes travel base64-encoded (atlas_read_board_object's
// own withheld-content contract) and have no text grid for
// encoding/csv to parse; an agent that needs to touch an .xlsx sheet
// re-creates it as CSV via atlas_create_board_object instead.

// resolvedSheet is one sheet object's identity plus its CSV file's
// current text -- everything a read or a write needs once resolveSheet
// has fail-closed on everything that isn't a readable CSV sheet.
type resolvedSheet struct {
	object atlas.BoardObject
	title  string
	text   string
}

func (m *MillMCPService) resolveSheet(objectID string) (resolvedSheet, error) {
	o, err := m.findBoardObject(objectID)
	if err != nil {
		return resolvedSheet{}, err
	}
	if o.Kind != "sheet" {
		return resolvedSheet{}, fmt.Errorf("board object %q is a %q, not a sheet -- these tools only read and edit sheet objects", objectID, o.Kind)
	}
	path := o.Payload["mirrorPath"]
	if path == "" {
		return resolvedSheet{}, fmt.Errorf("sheet %q has no file behind it to read", objectID)
	}
	if !strings.EqualFold(filepath.Ext(path), ".csv") {
		return resolvedSheet{}, fmt.Errorf("sheet %q is a binary spreadsheet (%s): only a CSV-backed sheet can be read or edited over MCP -- re-create it as CSV with atlas_create_board_object to make it agent-editable", objectID, filepath.Ext(path))
	}
	mc, err := m.atlas.ObjectMirrorContent(o.ID)
	if err != nil {
		return resolvedSheet{}, err
	}
	switch {
	case mc.Missing:
		return resolvedSheet{}, fmt.Errorf("the file behind sheet %q is gone from disk", objectID)
	case mc.TooLarge:
		return resolvedSheet{}, fmt.Errorf("the file behind sheet %q is too large to read", objectID)
	}
	return resolvedSheet{object: o, title: mirrorObjectTitle(o, path), text: mc.Content}, nil
}

// --- atlas_sheet_read_range ---

type atlasSheetReadRangeArgs struct {
	ObjectID string `json:"objectId" jsonschema:"the sheet board object's id (from atlas_read_board_objects)"`
	Range    string `json:"range,omitempty" jsonschema:"an A1-style range like B2:D5, or a single cell like B2. Omit to read the whole sheet."`
}

type atlasSheetDimensionsOut struct {
	Rows int `json:"rows"`
	Cols int `json:"cols"`
}

type atlasSheetReadRangeResult struct {
	Range      string                  `json:"range"`
	Values     [][]string              `json:"values"`
	Dimensions atlasSheetDimensionsOut `json:"dimensions"`
}

func (m *MillMCPService) readSheetRange(in atlasSheetReadRangeArgs) (atlasSheetReadRangeResult, error) {
	r, err := m.resolveSheet(in.ObjectID)
	if err != nil {
		return atlasSheetReadRangeResult{}, err
	}
	doc, err := sheet.ParseDocument(r.text)
	if err != nil {
		return atlasSheetReadRangeResult{}, err
	}
	rng, err := doc.ResolveRange(in.Range)
	if err != nil {
		return atlasSheetReadRangeResult{}, err
	}
	dims := doc.Dimensions()
	values := [][]string{}
	// An explicitly named range always reads (even past an empty
	// sheet's own extent, as all-empty cells); the default whole-sheet
	// range on a genuinely empty sheet stays an empty array rather than
	// fabricating a 1x1 grid from the zero Range ResolveRange answers.
	if in.Range != "" || (dims.Rows > 0 && dims.Cols > 0) {
		values = doc.ReadRange(rng)
	}
	return atlasSheetReadRangeResult{
		Range:      rng.String(),
		Values:     values,
		Dimensions: atlasSheetDimensionsOut{Rows: dims.Rows, Cols: dims.Cols},
	}, nil
}

// registerAtlasSheetTools wires the read tool plus the one gated write
// tool -- this kind's content contract (contract.ContentContracts),
// called through registerContentContracts (millmcpservice_tools.go).
func (m *MillMCPService) registerAtlasSheetTools() {
	mcp.AddTool(m.server, &mcp.Tool{
		Name: "atlas_sheet_read_range",
		Description: "A sheet board object's cells, by A1-style range (like B2:D5) or the whole sheet when range " +
			"is omitted. Returns the values as a 2-D array (row-major, top-left first) and the sheet's own " +
			"dimensions (rows/cols currently in use). A cell past the sheet's written extent reads as an empty " +
			"string, never an error. Only a CSV-backed sheet can be read this way; a binary .xlsx sheet's bytes " +
			"are read whole (base64) via atlas_read_board_object instead. Read this before " +
			"atlas_sheet_edit_cells. Read-only.",
		Annotations: readOnlyAnnotations,
	}, func(_ context.Context, _ *mcp.CallToolRequest, in atlasSheetReadRangeArgs) (*mcp.CallToolResult, any, error) {
		if err := m.requireAtlas(); err != nil {
			return nil, nil, err
		}
		out, err := m.readSheetRange(in)
		if err != nil {
			return nil, nil, err
		}
		res, err := jsonResult(out)
		return res, nil, err
	})

	m.registerAtlasSheetWriteTool()
}
