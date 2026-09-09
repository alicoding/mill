package contract

// ContentContract is one file-backed/entity-backed kind's agent-facing
// read+edit surface (goal 0388's RULE): every such kind registers a
// content contract -- read and edit tools scoped by the kind's own
// natural address (a diagram's cell ids, a sheet's A1 ranges, a
// list's rows) -- behind ONE write gate, ONE audit trail, ONE
// annotation set. Never a generic object.query/patch/replace/create
// tool (Notion's page-level-only MCP server is this rule's own
// confirmed cautionary precedent: docs/goals/0388-content-plane-over-
// mcp.md's Precedent section).
type ContentContract struct {
	// Kind is the content contract's own name -- a board object kind
	// (diagram, sheet) or a Configure entity kind (list).
	Kind string `json:"kind"`
	// ReadTool is the one MCP tool an agent calls to read this kind's
	// content by its own address.
	ReadTool string `json:"readTool"`
	// EditTools is every MCP tool that changes this kind's content --
	// more than one when a kind has several distinct edit verbs (a
	// diagram adds/edits/deletes/imports cells; a sheet only edits).
	EditTools []string `json:"editTools"`
}

// ContentContracts is the fixed, hand-maintained list of every kind's
// content contract. mcpsvc.MillMCPService's own tool registration
// (registerContentContracts) reads this SAME list to decide which
// kind's tools to wire, so the served contract document
// (mill://contract, GenerateDocument below) and the live tool registry
// can never name a different tool for the same kind.
var ContentContracts = []ContentContract{
	{
		Kind:      "diagram",
		ReadTool:  "atlas_read_diagram",
		EditTools: []string{"atlas_diagram_add_cells", "atlas_diagram_edit_cells", "atlas_diagram_delete_cells", "atlas_diagram_import"},
	},
	{
		Kind:      "sheet",
		ReadTool:  "atlas_sheet_read_range",
		EditTools: []string{"atlas_sheet_edit_cells"},
	},
	{
		Kind:      "xlsx",
		ReadTool:  "atlas_xlsx_read_range",
		EditTools: []string{"atlas_xlsx_edit_cells"},
	},
	{
		Kind:      "list",
		ReadTool:  "export_list",
		EditTools: []string{"list_append_row"},
	},
}
