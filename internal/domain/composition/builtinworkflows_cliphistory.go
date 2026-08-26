package composition

import "github.com/alicoding/mill/internal/domain/seedorigin"

// clipboardHistoryBuiltInWorkflow seeds "Clipboard history" (goal
// 0234): trigger-clipboard-change -> apply-clipboard-history-store.
// Ships PUBLISHED (v1 pinned in Versions, matching the draft head) but
// DISABLED: reading the clipboard is opt-in, and turning this workflow
// on IS the consent moment (ADR-0035 -- no Settings toggle implements
// this side effect; the workflow's own enable/disable is the whole
// surface, so a single un-disable is enough to arm it, no separate
// Publish step needed).
func clipboardHistoryBuiltInWorkflow() Workflow {
	const (
		triggerID = "clipboard-history-trigger"
		storeID   = "clipboard-history-store"
	)
	nodes, err := ResolveNodeDefaults([]Node{
		{ID: triggerID, NodeTypeID: "trigger-clipboard-change", Position: Position{X: 0, Y: 0}},
		{ID: storeID, NodeTypeID: "apply-clipboard-history-store", Position: Position{X: 0, Y: 100}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}
	edges := []Edge{
		{ID: "clipboard-history-e0", Source: triggerID, Target: storeID},
	}

	return Workflow{
		ID:          "clipboard-history-workflow",
		Label:       "Clipboard history",
		Description: "Watches the clipboard and saves each new copy to Clipboard history -- skips anything marked confidential by the app you copied it from, and skips writes Mill makes to the clipboard itself. Turn this on to start building history; turn it off to stop watching.",
		Nodes:       nodes,
		Edges:       edges,
		BuiltIn:     true,
		Seed:        seedorigin.Stamp(1),
		Disabled:    true,
		// Published so enabling this workflow is a single click -- no
		// separate Publish step (unlike the re-point-then-publish
		// examples elsewhere in this package, this seed needs no
		// per-user configuration before it's ready to run).
		PublishedVersion: 1,
		Versions: []WorkflowVersion{{
			Version: 1,
			Label:   "Clipboard history",
			Nodes:   nodes,
			Edges:   edges,
		}},
	}
}
