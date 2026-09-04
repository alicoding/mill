package composition

import "github.com/alicoding/mill/internal/domain/seedorigin"

// runInCapturedFolderWorkflow is goal 0345's own seed -- the working
// directory a shell step runs in coming from the run rather than a
// fixed Configure-authored environment. The workflow declares a typed
// "folder" Attribute (default /tmp, a directory every macOS/Linux
// install already has) standing in for whatever a real capture would
// supply, so the step's own workingDirectory field ("{folder}") is
// exercised deterministically without depending on Configure >
// Execution Environments. Split into its own file following
// builtinworkflows_codingloop.go's shape (a self-contained family with
// no nodes referenced elsewhere in this package).
func runInCapturedFolderWorkflow() Workflow {
	const (
		triggerID = "example-workingdir-trigger"
		injectID  = "example-workingdir-inject"
		shellID   = "example-workingdir-shell"
		notifyID  = "example-workingdir-notify"
	)
	nodes, err := ResolveNodeDefaults([]Node{
		{ID: triggerID, NodeTypeID: "trigger-manual", Position: Position{X: 0, Y: 0}},
		{ID: injectID, NodeTypeID: "process-inject-text", Position: Position{X: 0, Y: 100},
			Config: map[string]string{"text": "pwd", "placement": "append"}},
		{ID: shellID, NodeTypeID: "process-shell-command", Position: Position{X: 0, Y: 200},
			Config: map[string]string{"workingDirectory": "{folder}"}},
		{ID: notifyID, NodeTypeID: "apply-notify", Position: Position{X: 0, Y: 300},
			Config: map[string]string{"title": "Ran in the captured folder", "body": "pwd ran inside the folder Attribute. Open Mill to review the run."}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}

	return Workflow{
		ID:          "example-run-in-captured-folder-workflow",
		Label:       "Example: Run in the captured folder",
		Description: "Runs pwd inside a folder this run itself supplies, not a fixed one: the shell step's Working directory field reads {folder}, a typed Attribute defaulting to /tmp. Point a real capture at 'folder' (Configure > Attributes) to run wherever that capture points instead.",
		Nodes:       nodes,
		Attributes: []AttributeDef{
			{Key: "folder", Label: "Folder", Type: FieldText, Default: "/tmp",
				Description: "The directory the shell step below runs in."},
		},
		Edges: []Edge{
			{ID: "example-workingdir-e0", Source: triggerID, Target: injectID},
			{ID: "example-workingdir-e1", Source: injectID, Target: shellID},
			{ID: "example-workingdir-e2", Source: shellID, Target: notifyID},
		},
		BuiltIn: true,
		Seed:    seedorigin.Stamp(1),
	}
}
