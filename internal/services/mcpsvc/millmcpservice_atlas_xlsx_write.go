package mcpsvc

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/alicoding/mill/internal/domain/atlas/xlsx"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// The .xlsx sheet's one in-place write (goal 0365 S1), the same shape
// atlas_sheet_edit_cells and the four diagram writes already
// establish: parks through the shared gateWrite/registerWriteExecutor
// pair, rewrites ONLY the named cells -- every other cell, style,
// sheet and formula in the file comes back out unchanged -- and the
// approval prompt is written in the person's words, never a tool name
// or an id. Unlike the CSV sheet tool, the write lands through
// excelize's own Save on the opened workbook directly (xlsx.EditCells)
// rather than AtlasService.WriteObjectMirror, which refuses a binary
// spreadsheet outright (goal 0239 S2's corruption guard) -- excelize
// writes the SAME file path that guard protects, just through the
// door built to open it safely.

type atlasXlsxCellEdit struct {
	Address string  `json:"address" jsonschema:"an A1-style cell address, like B2"`
	Value   *string `json:"value,omitempty" jsonschema:"the cell's new literal text value. Name exactly one of value or formula."`
	Formula *string `json:"formula,omitempty" jsonschema:"the cell's new formula, Excel syntax, with or without a leading =. Name exactly one of value or formula."`
}

type atlasXlsxEditCellsArgs struct {
	ObjectID string              `json:"objectId" jsonschema:"the sheet board object's id"`
	Sheet    string              `json:"sheet,omitempty" jsonschema:"which sheet to edit, by name. Omit for the workbook's first sheet."`
	Edits    []atlasXlsxCellEdit `json:"edits" jsonschema:"one entry per cell to change"`
}

type atlasXlsxEditCellsResult struct {
	Updated int `json:"updated"`
}

// requireXlsxWrite runs every check that can be answered without
// touching the file's cells, BEFORE the write parks -- the same
// fail-closed-before-park discipline requireSheetWrite/requireDiagramWrite
// already apply: a call that could never succeed must never reach a
// person's approval queue.
func (m *MillMCPService) requireXlsxWrite(objectID string) (resolvedXlsx, error) {
	if err := m.requireWriteEnabled(); err != nil {
		return resolvedXlsx{}, err
	}
	if err := m.requireAtlas(); err != nil {
		return resolvedXlsx{}, err
	}
	return m.resolveXlsx(objectID)
}

func (m *MillMCPService) executeXlsxEditCells(argsJSON string) (string, error) {
	var in atlasXlsxEditCellsArgs
	if err := json.Unmarshal([]byte(argsJSON), &in); err != nil {
		return "", err
	}
	r, err := m.resolveXlsx(in.ObjectID)
	if err != nil {
		return "", err
	}
	edits := make([]xlsx.CellEdit, len(in.Edits))
	for i, e := range in.Edits {
		edits[i] = xlsx.CellEdit{Address: e.Address, Value: e.Value, Formula: e.Formula}
	}
	if err := xlsx.EditCells(r.path, in.Sheet, edits); err != nil {
		return "", err
	}
	return jsonText(atlasXlsxEditCellsResult{Updated: len(in.Edits)})
}

func (m *MillMCPService) registerAtlasXlsxWriteTool() {
	m.registerWriteExecutor("atlas_xlsx_edit_cells", m.executeXlsxEditCells)
	mcp.AddTool(m.server, &mcp.Tool{
		Name: "atlas_xlsx_edit_cells",
		Description: "Change cells a real .xlsx workbook already has, by A1-style address -- one call may change " +
			"several cells at once, on the sheet named (or the workbook's first sheet). Each edit names EXACTLY " +
			"ONE of value (literal text) or formula (Excel syntax); naming both, or neither, fails the whole call " +
			"before anything is written. Everything else in the file -- other cells, styles, other sheets, merged " +
			"ranges -- comes back unchanged. A formula is stored but never recalculated here; its value stays " +
			"whatever was last cached until the file next opens in a spreadsheet app. " + approvalPollNote,
		Annotations: editAnnotations,
	}, func(_ context.Context, _ *mcp.CallToolRequest, in atlasXlsxEditCellsArgs) (*mcp.CallToolResult, any, error) {
		r, err := m.requireXlsxWrite(in.ObjectID)
		if err != nil {
			return nil, nil, err
		}
		if len(in.Edits) == 0 {
			return nil, nil, fmt.Errorf("name at least one cell to edit")
		}
		argsJSON, err := marshalArgs(in)
		if err != nil {
			return nil, nil, err
		}
		res, err := m.gateWrite("atlas_xlsx_edit_cells",
			fmt.Sprintf("Edit %s in %s", pluralCells(len(in.Edits)), r.title), argsJSON)
		return res, nil, err
	})
}
