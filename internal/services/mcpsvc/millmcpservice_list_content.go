package mcpsvc

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// list_append_row promotes AppendListRow from a plugin-only door to a
// first-class Mill tool (goal 0388): until now, appending a row to an
// EXISTING List was reachable only through a plugin's own declared
// tool wrapping ctx.content.appendListRow
// (pluginservice_content.go:246); this calls the SAME
// ConfigureService.AddListRow a plugin's own door already calls --
// one shared executor, two doors, never two implementations. export_list
// (millmcpservice_tools.go) is this content contract's read half; no
// twin read tool is added here (a List's full columns+rows are already
// a first-class MCP read).
//
// Same gate and audit as every other write tool in this package:
// requireWriteEnabled + gateWrite, mcpaudit's generic server
// middleware records the call regardless of kind.

type listAppendRowArgs struct {
	ListID string            `json:"listId" jsonschema:"the List's id (see export_list or the mill://lists resource)"`
	Row    map[string]string `json:"row" jsonschema:"the new row's values, keyed by the List's declared column key (export_list reports them)"`
}

type listAppendRowResult struct {
	RowID string `json:"rowId"`
}

// checkListAppendRow answers everything that can be known before the
// write parks, so a call naming a nonexistent List never reaches a
// person's approval queue -- the same fail-closed-before-park
// discipline every other write tool here applies. Returns the List's
// label for the approval banner.
func (m *MillMCPService) checkListAppendRow(in listAppendRowArgs) (string, error) {
	if err := m.requireWriteEnabled(); err != nil {
		return "", err
	}
	if in.ListID == "" {
		return "", fmt.Errorf("listId is required")
	}
	if len(in.Row) == 0 {
		return "", fmt.Errorf("name at least one column value to append")
	}
	l, err := m.cfg.GetList(in.ListID)
	if err != nil {
		return "", err
	}
	return l.Label, nil
}

func (m *MillMCPService) executeListAppendRow(argsJSON string) (string, error) {
	var in listAppendRowArgs
	if err := json.Unmarshal([]byte(argsJSON), &in); err != nil {
		return "", err
	}
	l, err := m.cfg.AddListRow(in.ListID, in.Row)
	if err != nil {
		return "", err
	}
	if len(l.Rows) == 0 {
		return "", fmt.Errorf("append succeeded but the list reported no rows")
	}
	return jsonText(listAppendRowResult{RowID: l.Rows[len(l.Rows)-1].ID})
}

// registerListContentTools wires list_append_row -- List's content
// contract (contract.ContentContracts), called through
// registerContentContracts (millmcpservice_tools.go).
func (m *MillMCPService) registerListContentTools() {
	m.registerWriteExecutor("list_append_row", m.executeListAppendRow)
	mcp.AddTool(m.server, &mcp.Tool{
		Name: "list_append_row",
		Description: "Append one new row to an EXISTING List, keyed by its declared column keys (export_list " +
			"shows them). Never overwrites or reorders a row already there -- import_list is the separate " +
			"door for minting a brand-new List. " + approvalPollNote,
		Annotations: appendAnnotations,
	}, func(_ context.Context, _ *mcp.CallToolRequest, in listAppendRowArgs) (*mcp.CallToolResult, any, error) {
		label, err := m.checkListAppendRow(in)
		if err != nil {
			return nil, nil, err
		}
		argsJSON, err := marshalArgs(in)
		if err != nil {
			return nil, nil, err
		}
		res, err := m.gateWrite("list_append_row", fmt.Sprintf("Append a row to %s", label), argsJSON)
		return res, nil, err
	})
}
