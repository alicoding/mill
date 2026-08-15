package composition

import "github.com/alicoding/mill/internal/domain/seedorigin"

// The backup seed (docs/goals/0065, ADR-0035's dogfood pattern):
// scheduled backup cadence arrives as composition -- a trigger-schedule
// + apply-backup-snapshot pair -- never a bespoke cron loop, so cadence
// and retention stay as user-editable as any other workflow. Split into
// its own file for the same "split along a real seam" reason
// builtinworkflows_receipt.go/builtinworkflows_list.go already are.

// backupMillDataWorkflow ships ENABLED (unlike the "Example: ..."
// demo seeds, which start disabled/manual by design) -- this is a real
// production capability, the same posture "Load sample HTML"/
// "Clipboard -> Markdown" already take.
func backupMillDataWorkflow() Workflow {
	const (
		triggerID = "backup-mill-data-trigger"
		applyID   = "backup-mill-data-apply"
	)
	nodes, err := ResolveNodeDefaults([]Node{
		{ID: triggerID, NodeTypeID: "trigger-schedule", Position: Position{X: 0, Y: 0},
			Config: map[string]string{"cron": "0 3 * * *"}},
		{ID: applyID, NodeTypeID: "apply-backup-snapshot", Position: Position{X: 0, Y: 100},
			Config: map[string]string{"keepN": "10"}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}

	return Workflow{
		ID:          "backup-mill-data-workflow",
		Label:       "Backup Mill data",
		Description: "Snapshots your workflow history and settings every day at 3am, keeping the 10 most recent backups. Change the schedule or how many to keep like any other workflow.",
		Nodes:       nodes,
		Edges: []Edge{
			{ID: "backup-mill-data-e0", Source: triggerID, Target: applyID},
		},
		BuiltIn: true,
		Seed:    seedorigin.Stamp(1),
	}
}

// builtInBackupWorkflows is the append-point BuiltInWorkflows() calls,
// same shape as builtInReceiptWorkflows/builtInListWorkflows.
func builtInBackupWorkflows() []Workflow {
	return []Workflow{backupMillDataWorkflow()}
}
