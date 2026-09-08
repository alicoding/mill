package mcpsvc

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/alicoding/mill/internal/domain/atlas/sheet"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// The sheet's one in-place write (goal 0388), the same shape the four
// diagram writes already establish: parks through the shared
// gateWrite/registerWriteExecutor pair, rewrites ONLY the named cells
// -- every other cell, row and column comes back out unchanged -- and
// the approval prompt is written in the person's words, never a tool
// name or an id.

type atlasSheetCellEdit struct {
	Address string `json:"address" jsonschema:"an A1-style cell address, like B2"`
	Value   string `json:"value" jsonschema:"the cell's new text value"`
}

type atlasSheetEditCellsArgs struct {
	ObjectID string               `json:"objectId" jsonschema:"the sheet board object's id"`
	Edits    []atlasSheetCellEdit `json:"edits" jsonschema:"one entry per cell to change"`
}

type atlasSheetEditCellsResult struct {
	Updated int `json:"updated"`
}

// requireSheetWrite runs every check that can be answered without
// touching the file's cells, BEFORE the write parks -- the same
// fail-closed-before-park discipline requireDiagramWrite already
// applies: a call that could never succeed must never reach a
// person's approval queue.
func (m *MillMCPService) requireSheetWrite(objectID string) (resolvedSheet, error) {
	if err := m.requireWriteEnabled(); err != nil {
		return resolvedSheet{}, err
	}
	if err := m.requireAtlas(); err != nil {
		return resolvedSheet{}, err
	}
	return m.resolveSheet(objectID)
}

func (m *MillMCPService) executeSheetEditCells(argsJSON string) (string, error) {
	var in atlasSheetEditCellsArgs
	if err := json.Unmarshal([]byte(argsJSON), &in); err != nil {
		return "", err
	}
	r, err := m.resolveSheet(in.ObjectID)
	if err != nil {
		return "", err
	}
	doc, err := sheet.ParseDocument(r.text)
	if err != nil {
		return "", err
	}
	edits := make([]sheet.CellEdit, len(in.Edits))
	for i, e := range in.Edits {
		edits[i] = sheet.CellEdit{Address: e.Address, Value: e.Value}
	}
	updated, err := doc.EditCells(edits)
	if err != nil {
		return "", err
	}
	text, err := doc.Marshal()
	if err != nil {
		return "", err
	}
	if err := m.atlas.WriteObjectMirror(in.ObjectID, text); err != nil {
		return "", err
	}
	return jsonText(atlasSheetEditCellsResult{Updated: updated})
}

func (m *MillMCPService) registerAtlasSheetWriteTool() {
	m.registerWriteExecutor("atlas_sheet_edit_cells", m.executeSheetEditCells)
	mcp.AddTool(m.server, &mcp.Tool{
		Name: "atlas_sheet_edit_cells",
		Description: "Change cells a sheet already has (or extend it), by A1-style address -- one call may " +
			"change several cells at once. A row shorter than an edited column (or a row past the sheet's " +
			"current end) pads with empty cells only as far as the edit, the same convention typing past a " +
			"row's end in a real spreadsheet follows. An unparseable address fails the whole call before " +
			"anything is written. " + approvalPollNote,
		Annotations: editAnnotations,
	}, func(_ context.Context, _ *mcp.CallToolRequest, in atlasSheetEditCellsArgs) (*mcp.CallToolResult, any, error) {
		r, err := m.requireSheetWrite(in.ObjectID)
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
		res, err := m.gateWrite("atlas_sheet_edit_cells",
			fmt.Sprintf("Edit %s in %s", pluralCells(len(in.Edits)), r.title), argsJSON)
		return res, nil, err
	})
}
