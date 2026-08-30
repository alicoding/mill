package composition

import "github.com/alicoding/mill/internal/domain/seedorigin"

// The coding-loop seed (docs/goals/0240 S1): a captured clipboard
// command block, run for real and reported back. Split out of
// builtinworkflows.go (500-line convention, .claude/rules/
// architecture.md), same shape as clipboardBuiltInWorkflows.
//
// CodingLoopWorkflowID/CodingLoopShellStepID are exported/named so
// codeloopsvc (the Wails-bound preview/run entry points) and this
// package's own tests reference the same IDs the seed itself declares,
// never a second string literal that could drift.
const (
	CodingLoopWorkflowID  = "coding-loop-run-copied-command-workflow" //nolint:gosec // a workflow ID string, not a credential -- gosec's G101 name heuristic false-positives on "...ID"
	CodingLoopShellStepID = "coding-loop-shell-step"
)

func codingLoopBuiltInWorkflow() []Workflow {
	const (
		triggerID = "coding-loop-trigger"
		applyID   = "coding-loop-apply-clipboard"
		notifyID  = "coding-loop-notify"
	)
	nodes, err := ResolveNodeDefaults([]Node{
		{ID: triggerID, NodeTypeID: "trigger-manual", Position: Position{X: 0, Y: 0}},
		{ID: CodingLoopShellStepID, NodeTypeID: "process-shell-command", Position: Position{X: 0, Y: 100}},
		{ID: applyID, NodeTypeID: "apply-clipboard-write-text", Position: Position{X: 0, Y: 200}},
		{ID: notifyID, NodeTypeID: "apply-notify", Position: Position{X: 0, Y: 300},
			Config: map[string]string{"title": "Run from clipboard", "body": "Result copied -- open Mill to review the run."}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}

	return []Workflow{
		{
			ID:          CodingLoopWorkflowID,
			Label:       "Run from clipboard",
			Description: "Runs a copied shell command block, then copies the result back to your clipboard and notifies you. Started from the command palette or Quick Panel, which show the parsed steps and ask for approval before anything runs; assign this workflow's own hotkey (canvas Inspector) if you'd rather trigger it directly, without that preview.",
			Nodes:       nodes,
			Edges: []Edge{
				{ID: "coding-loop-e0", Source: triggerID, Target: CodingLoopShellStepID},
				{ID: "coding-loop-e1", Source: CodingLoopShellStepID, Target: applyID},
				{ID: "coding-loop-e2", Source: applyID, Target: notifyID},
			},
			BuiltIn: true,
			Seed:    seedorigin.Stamp(3),
		},
	}
}
