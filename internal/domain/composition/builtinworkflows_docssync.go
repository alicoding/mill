package composition

import "github.com/alicoding/mill/internal/domain/seedorigin"

// builtInDocsSyncWorkflows is goal 0108's generated-from-docs proof: a
// one-node workflow whose apply-atlas-docs-sync step mirrors every
// markdown file in a folder as a card under one parent, idempotently
// (existing mirrors keep their card, checksums refresh). Ships with an
// EMPTY folder path -- the established capture-file/filemove seed
// stance: it demonstrates the shape and errors honestly ("folderPath
// is required") until pointed at a real folder.
func builtInDocsSyncWorkflows() []Workflow {
	const (
		docsSyncTriggerID = "example-docssync-trigger"
		docsSyncApplyID   = "example-docssync-apply"
	)
	nodes, err := ResolveNodeDefaults([]Node{
		{ID: docsSyncTriggerID, NodeTypeID: "trigger-manual", Position: Position{X: 0, Y: 0}},
		{ID: docsSyncApplyID, NodeTypeID: "apply-atlas-docs-sync", Position: Position{X: 0, Y: 100},
			Config: map[string]string{
				"folderPath":      "",
				"parentTitle":     "Synced docs",
				"kindLabel":       "Document",
				"outputAttribute": "sync_summary",
			}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}

	return []Workflow{
		{
			ID:          "example-docssync-workflow",
			Label:       "Example: Mirror a docs folder into Atlas",
			Description: "Mirrors every markdown file in a folder as a card under one parent card, safely re-runnable: files already mirrored keep their card, new files become new cards. Set the folder path on the step, then run it whenever the docs change.",
			Nodes:       nodes,
			Edges: []Edge{
				{ID: "example-docssync-e0", Source: docsSyncTriggerID, Target: docsSyncApplyID},
			},
			BuiltIn:     true,
			Seed:        seedorigin.Stamp(1),
		},
	}
}
