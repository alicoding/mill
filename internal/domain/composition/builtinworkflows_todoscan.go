package composition

import "github.com/alicoding/mill/internal/domain/seedorigin"

// builtInTodoScanWorkflows is goal 0285's own seeded proof:
// process-todo-scan chained into apply-file-write, writing the marker
// table to a CSV file -- which lands on the board as a sheet object via
// the existing native-file-drop path once it's dragged there (no node
// creates the sheet object directly; see this goal's own deferral
// note). Ships DISABLED with no folder configured, same
// belt-and-suspenders shape "File the client inbox" already
// established -- it never scans anything on a real machine until
// pointed at a real folder and enabled.
func builtInTodoScanWorkflows() []Workflow {
	const (
		todoScanTriggerID = "example-todoscan-trigger"
		todoScanScanID    = "example-todoscan-scan"
		todoScanWriteID   = "example-todoscan-write"
	)
	nodes, err := ResolveNodeDefaults([]Node{
		{ID: todoScanTriggerID, NodeTypeID: "trigger-manual", Position: Position{X: 0, Y: 0}},
		{ID: todoScanScanID, NodeTypeID: "process-todo-scan", Position: Position{X: 0, Y: 100},
			Config: map[string]string{"path": ""}},
		{ID: todoScanWriteID, NodeTypeID: "apply-file-write", Position: Position{X: 0, Y: 200},
			Config: map[string]string{"path": "todo-scan.csv", "mode": "overwrite", "createDirs": "true"}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}

	return []Workflow{
		{
			ID:          "example-todo-scan-workflow",
			Label:       "Open items → sheet",
			Description: "Scans the engagement folder for open items and writes them to a sheet.",
			Nodes:       nodes,
			Edges: []Edge{
				{ID: "example-todoscan-e0", Source: todoScanTriggerID, Target: todoScanScanID},
				{ID: "example-todoscan-e1", Source: todoScanScanID, Target: todoScanWriteID},
			},
			BuiltIn:  true,
			Seed:     seedorigin.Stamp(2),
			Disabled: true,
		},
	}
}
