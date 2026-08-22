package composition

import "github.com/alicoding/mill/internal/domain/seedorigin"

// builtInLedgerSyncWorkflows is goal 0164 L1's delivery-evidence-ledger
// proof: a one-node workflow whose apply-atlas-ledger-sync step mirrors
// every frontmattered markdown file in a folder as a Delivered feature
// card. Ships with an EMPTY folder path -- the established capture-
// file/filemove/docssync seed stance: it demonstrates the shape and
// errors honestly ("folderPath is required") until pointed at a real
// goals-archive folder.
func builtInLedgerSyncWorkflows() []Workflow {
	const (
		ledgerSyncTriggerID = "example-ledgersync-trigger"
		ledgerSyncApplyID   = "example-ledgersync-apply"
	)
	nodes, err := ResolveNodeDefaults([]Node{
		{ID: ledgerSyncTriggerID, NodeTypeID: "trigger-manual", Position: Position{X: 0, Y: 0}},
		{ID: ledgerSyncApplyID, NodeTypeID: "apply-atlas-ledger-sync", Position: Position{X: 0, Y: 100},
			Config: map[string]string{
				"folderPath":      "",
				"parentTitle":     "Delivered features",
				"outputAttribute": "sync_summary",
			}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}

	return []Workflow{
		{
			ID:    "example-ledgersync-workflow",
			Label: "Example: Delivery ledger",
			Description: "Mirrors every frontmattered goal file in a folder as a Delivered feature card, safely " +
				"re-runnable: your sign-off, verified date, and notes always survive a re-sync. Point the folder " +
				"path at your goals archive, then run it whenever goals ship.",
			Nodes: nodes,
			Edges: []Edge{
				{ID: "example-ledgersync-e0", Source: ledgerSyncTriggerID, Target: ledgerSyncApplyID},
			},
			BuiltIn: true,
			Seed:    seedorigin.Stamp(1),
		},
	}
}
