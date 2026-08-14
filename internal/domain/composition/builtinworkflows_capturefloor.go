package composition

import "github.com/alicoding/mill/internal/domain/seedorigin"

// The save-page capture floor + clipboard inspector seeds -- split out
// of builtinworkflows.go once that file crossed the 500-line limit
// (.claude/rules/architecture.md), same "split along a real seam"
// discipline nodetypes.go's own doc comment already established. Each
// function builds one Workflow, called from BuiltInWorkflows()'s
// returned slice.

// clipboardInspectorWorkflow is the §5/§8 clipboard-flavor diagnostic
// made runnable -- capture-clipboard-info's own real "what's actually
// on the clipboard right now" answer, one click away. Ends at a Capture
// leaf with nowhere to deliver its result (the established, accepted
// "process-leaf" validation warning pattern -- its output lives in run
// history, same as every other seed this shape applies to).
func clipboardInspectorWorkflow() Workflow {
	const (
		triggerID = "example-clipinfo-trigger"
		captureID = "example-clipinfo-capture"
	)
	nodes, err := ResolveNodeDefaults([]Node{
		{ID: triggerID, NodeTypeID: "trigger-manual", Position: Position{X: 0, Y: 0}},
		{ID: captureID, NodeTypeID: "capture-clipboard-info", Position: Position{X: 0, Y: 100}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}

	return Workflow{
		ID:          "example-clipboard-inspector-workflow",
		Label:       "Example: Clipboard inspector",
		Description: "Reads macOS's own \"clipboard info\" report and summarizes which flavors -- HTML, plain text -- are actually on the clipboard right now (docs/SPEC.md §5's Confluence-clipboard-ambiguity question, made directly inspectable). Ends at a Capture step with nowhere to deliver its result -- fine for a click-to-run diagnostic; its output lives in this workflow's own Runs tab.",
		Nodes:       nodes,
		Edges: []Edge{
			{ID: "example-clipinfo-e0", Source: triggerID, Target: captureID},
		},
		BuiltIn: true,
		Seed:    seedorigin.Stamp(1),
	}
}

// savedPageToMarkdownWorkflow is the capture floor docs/SPEC.md §2.1/§5
// actually needs: a filesystem-watch trigger's changed path
// (docs/SPEC.md §3.4's Trigger row, threaded through as the run's
// starting payload) read as a file, the main-content subtree extracted
// (dropping nav/header/footer chrome -- the Confluence-full-page-copy
// problem §5 names), converted to Markdown, written to the clipboard.
// Ships DISABLED with a placeholder watch path (~/Mill Captures, unlike
// "Example: Disabled filesystem watch"'s belt-and-suspenders empty
// path -- this seed deliberately shows a real-looking path so a user
// sees what to point it at) -- never watches anything on a real machine
// until pointed at a real directory, published, and enabled.
func savedPageToMarkdownWorkflow() Workflow {
	const (
		triggerID  = "example-savedpage-trigger"
		captureID  = "example-savedpage-capture"
		extractID  = "example-savedpage-extract"
		markdownID = "example-savedpage-markdown"
		applyID    = "example-savedpage-apply"
	)
	nodes, err := ResolveNodeDefaults([]Node{
		{ID: triggerID, NodeTypeID: "trigger-filesystem-watch", Position: Position{X: 0, Y: 0},
			Config: map[string]string{"path": "~/Mill Captures", "pattern": ""}},
		{ID: captureID, NodeTypeID: "capture-file", Position: Position{X: 0, Y: 100},
			Config: map[string]string{"source": "payload"}},
		{ID: extractID, NodeTypeID: "process-extract-html", Position: Position{X: 0, Y: 200}},
		{ID: markdownID, NodeTypeID: "process-html-to-markdown", Position: Position{X: 0, Y: 300}},
		{ID: applyID, NodeTypeID: "apply-clipboard-write-text", Position: Position{X: 0, Y: 400}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}

	return Workflow{
		ID:          "example-saved-page-to-markdown-workflow",
		Label:       "Example: Saved page → Markdown",
		Description: "The saved-page capture floor docs/SPEC.md §2.1/§5 names: watches a folder for a saved HTML page, reads it, extracts the main-content subtree (dropping nav/header/footer chrome), converts it to Markdown, and writes the result to the clipboard. Ships DISABLED with a placeholder watch path (~/Mill Captures) -- point its trigger at a real directory (the canvas Inspector), publish, and enable it to see it fire when a page lands there.",
		Nodes:       nodes,
		Edges: []Edge{
			{ID: "example-savedpage-e0", Source: triggerID, Target: captureID},
			{ID: "example-savedpage-e1", Source: captureID, Target: extractID},
			{ID: "example-savedpage-e2", Source: extractID, Target: markdownID},
			{ID: "example-savedpage-e3", Source: markdownID, Target: applyID},
		},
		BuiltIn:  true,
		Seed:     seedorigin.Stamp(1),
		Disabled: true,
	}
}

// scratchCaptureWorkflow is the capture-first note-taking loop's
// simplest form: whatever's on the clipboard, appended straight to a
// running scratch file with a timestamp, no filing decision at capture
// time. Ships manual-triggered (every other capture-shaped seed in
// this package does the same) so it never writes to a real path on
// your machine until you run it yourself; swap the trigger for a
// hotkey (canvas Inspector) for the one-keystroke version.
func scratchCaptureWorkflow() Workflow {
	const (
		triggerID = "example-scratchcapture-trigger"
		captureID = "example-scratchcapture-capture"
		applyID   = "example-scratchcapture-apply"
	)
	nodes, err := ResolveNodeDefaults([]Node{
		{ID: triggerID, NodeTypeID: "trigger-manual", Position: Position{X: 0, Y: 0}},
		{ID: captureID, NodeTypeID: "capture-clipboard-html", Position: Position{X: 0, Y: 100}},
		{ID: applyID, NodeTypeID: "apply-file-write", Position: Position{X: 0, Y: 200},
			Config: map[string]string{"path": "~/Mill Scratch/scratch.md", "mode": "append", "createDirs": "true", "timestamp": "datetime"}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}

	return Workflow{
		ID:          "example-scratch-capture-workflow",
		Label:       "Example: Scratch capture",
		Description: "Grabs whatever's on the clipboard and appends it to a scratch file, each entry stamped with the date and time -- run it whenever you copy something worth keeping, and sort it out later.",
		Nodes:       nodes,
		Edges: []Edge{
			{ID: "example-scratchcapture-e0", Source: triggerID, Target: captureID},
			{ID: "example-scratchcapture-e1", Source: captureID, Target: applyID},
		},
		BuiltIn: true,
		Seed:    seedorigin.Stamp(1),
	}
}
