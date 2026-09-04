package composition

import "github.com/alicoding/mill/internal/domain/seedorigin"

// builtInFileMoveWorkflows is goal 0087's own seeded proof: the watch ->
// classify -> file-into-place recipe, chaining trigger-filesystem-watch
// into a ruleset gate (only files with a real extension go through) into
// apply-file-move (filed into a dated subfolder of the same watched
// directory). Split out of builtinworkflows.go once that file crossed
// the 500-line convention, same split-file reasoning every other
// builtinworkflows_*.go file already follows. Ships DISABLED with no
// watched path, same belt-and-suspenders shape "Example: Disabled
// filesystem watch" already established -- it never watches anything on
// a real machine until pointed at a real directory and enabled.
func builtInFileMoveWorkflows() []Workflow {
	const (
		fileMoveTriggerID = "example-filemove-trigger"
		fileMoveRulesetID = "example-filemove-ruleset"
		fileMoveApplyID   = "example-filemove-apply"
	)
	nodes, err := ResolveNodeDefaults([]Node{
		{ID: fileMoveTriggerID, NodeTypeID: "trigger-filesystem-watch", Position: Position{X: 0, Y: 0},
			Config: map[string]string{"path": ""}},
		{ID: fileMoveRulesetID, NodeTypeID: "ruleset", Position: Position{X: 0, Y: 100},
			Config: map[string]string{"rulesJSON": `[{"name":"has a file extension","condition":"hasSuffix(Payload, \".txt\") || hasSuffix(Payload, \".pdf\") || hasSuffix(Payload, \".csv\")"}]`}},
		{ID: fileMoveApplyID, NodeTypeID: "apply-file-move", Position: Position{X: 0, Y: 200},
			// ".../" is a visible placeholder, not a real path -- same
			// belt-and-suspenders stance as the trigger's own empty path
			// above: even if someone enabled this without ever touching
			// Destination, it resolves under a literal "..." folder next
			// to wherever Mill runs, not silently into a real location.
			Config: map[string]string{"destination": ".../{date:2006-01}/{filename}", "createDirs": "true", "onConflict": "suffix"}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}

	return []Workflow{
		{
			ID:          "example-filemove-workflow",
			Label:       "Example: File inbox to folder",
			Description: "Watches a folder, checks each new file's type, then files matching files into a dated subfolder. Ships DISABLED with no watched path, so it never watches anything on your machine as shipped. Point its trigger at a real directory (the canvas Inspector), publish, and enable it to see files move automatically.",
			Nodes:       nodes,
			Edges: []Edge{
				{ID: "example-filemove-e0", Source: fileMoveTriggerID, Target: fileMoveRulesetID},
				{ID: "example-filemove-e1", Source: fileMoveRulesetID, Target: fileMoveApplyID},
			},
			BuiltIn:  true,
			Seed:     seedorigin.Stamp(2),
			Disabled: true,
		},
	}
}
