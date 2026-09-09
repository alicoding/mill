package mcpsvc

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/domain/atlas/xlsx"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// A real .xlsx workbook as a programmable content plane (goal 0365
// S1), the sheet contract's own extension: the sheet noun's binary
// door. The CSV-backed sheet tools (atlas_sheet_read_range/
// atlas_sheet_edit_cells, goal 0388) explicitly refuse a binary
// workbook (millmcpservice_atlas_sheet.go's own resolveSheet); these
// two tools are that refusal's answer, opening the real .xlsx FILE
// with excelize (internal/domain/atlas/xlsx) and editing named cells
// in place instead -- never a whole-file regenerate, and never a
// spreadsheet engine embedded in Mill itself (goal 0365's own Adoption
// decision: the file is the content, the user's app is the authoring
// plane).
//
// Recalculation is never performed: a formula's cached value can go
// stale until the file next opens in the user's own spreadsheet app.
// Both tool descriptions below say so.

// resolvedXlsx is one .xlsx sheet object's identity plus its file's
// path on disk -- everything a read or a write needs once resolveXlsx
// has fail-closed on everything that isn't a readable .xlsx workbook.
// Unlike resolvedSheet (CSV, held as text in memory), the file's bytes
// never pass through Go as a string: excelize opens the real path
// directly, so a binary workbook is never base64-round-tripped just to
// read one cell.
type resolvedXlsx struct {
	object atlas.BoardObject
	title  string
	path   string
}

func (m *MillMCPService) resolveXlsx(objectID string) (resolvedXlsx, error) {
	o, err := m.findBoardObject(objectID)
	if err != nil {
		return resolvedXlsx{}, err
	}
	if o.Kind != "sheet" {
		return resolvedXlsx{}, fmt.Errorf("board object %q is a %q, not a sheet -- these tools only read and edit .xlsx sheet objects", objectID, o.Kind)
	}
	path := o.Payload["mirrorPath"]
	if path == "" {
		return resolvedXlsx{}, fmt.Errorf("sheet %q has no file behind it to read", objectID)
	}
	if !strings.EqualFold(filepath.Ext(path), ".xlsx") {
		return resolvedXlsx{}, fmt.Errorf("sheet %q is not an .xlsx workbook (%s) -- these tools only read and edit .xlsx files; "+
			"a CSV-backed sheet uses atlas_sheet_read_range/atlas_sheet_edit_cells instead", objectID, filepath.Ext(path))
	}
	// ObjectMirrorContent's own missing/too-large classification is
	// reused here for its file-state check alone -- its base64 Content
	// is never read, since excelize opens path itself below.
	mc, err := m.atlas.ObjectMirrorContent(o.ID)
	if err != nil {
		return resolvedXlsx{}, err
	}
	switch {
	case mc.Missing:
		return resolvedXlsx{}, fmt.Errorf("the file behind sheet %q is gone from disk", objectID)
	case mc.TooLarge:
		return resolvedXlsx{}, fmt.Errorf("the file behind sheet %q is too large to read", objectID)
	}
	return resolvedXlsx{object: o, title: mirrorObjectTitle(o, path), path: path}, nil
}

// --- atlas_xlsx_read_range ---

type atlasXlsxReadRangeArgs struct {
	ObjectID string `json:"objectId" jsonschema:"the sheet board object's id (from atlas_read_board_objects)"`
	Sheet    string `json:"sheet,omitempty" jsonschema:"which sheet to read, by name. Omit for the workbook's first sheet."`
	Range    string `json:"range,omitempty" jsonschema:"an A1-style range like B2:D5, or a single cell like B2. Omit to read the whole sheet."`
}

type atlasXlsxReadRangeResult struct {
	Sheet      string                  `json:"sheet"`
	Range      string                  `json:"range"`
	Values     [][]string              `json:"values"`
	Formulas   [][]string              `json:"formulas"`
	Dimensions atlasSheetDimensionsOut `json:"dimensions"`
}

func (m *MillMCPService) readXlsxRange(in atlasXlsxReadRangeArgs) (atlasXlsxReadRangeResult, error) {
	r, err := m.resolveXlsx(in.ObjectID)
	if err != nil {
		return atlasXlsxReadRangeResult{}, err
	}
	res, err := xlsx.ReadRange(r.path, in.Sheet, in.Range)
	if err != nil {
		return atlasXlsxReadRangeResult{}, err
	}
	return atlasXlsxReadRangeResult{
		Sheet:      res.Sheet,
		Range:      res.Range,
		Values:     res.Values,
		Formulas:   res.Formulas,
		Dimensions: atlasSheetDimensionsOut{Rows: res.Dimensions.Rows, Cols: res.Dimensions.Cols},
	}, nil
}

// registerAtlasXlsxTools wires the read tool plus the one gated write
// tool -- this kind's content contract (contract.ContentContracts),
// called through registerContentContracts (millmcpservice_tools.go).
func (m *MillMCPService) registerAtlasXlsxTools() {
	mcp.AddTool(m.server, &mcp.Tool{
		Name: "atlas_xlsx_read_range",
		Description: "A real .xlsx workbook's cells, by A1-style range (like B2:D5) or the whole sheet when range " +
			"is omitted. sheet picks which sheet, by name; omit for the workbook's first sheet. Returns the values " +
			"as displayed (2-D array, row-major) and, in the parallel formulas array, each cell's own formula text " +
			"where it holds one (empty string otherwise). A cell past the sheet's written extent reads as an empty " +
			"string, never an error. A formula's value is never recalculated here -- it reads back whatever was " +
			"cached the last time the file was saved in a spreadsheet app, which can be stale. Read this before " +
			"atlas_xlsx_edit_cells. Read-only.",
		Annotations: readOnlyAnnotations,
	}, func(_ context.Context, _ *mcp.CallToolRequest, in atlasXlsxReadRangeArgs) (*mcp.CallToolResult, any, error) {
		if err := m.requireAtlas(); err != nil {
			return nil, nil, err
		}
		out, err := m.readXlsxRange(in)
		if err != nil {
			return nil, nil, err
		}
		res, err := jsonResult(out)
		return res, nil, err
	})

	m.registerAtlasXlsxWriteTool()
}
