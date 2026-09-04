package composition

import "github.com/alicoding/mill/internal/domain/seedorigin"

// ExampleSha256ClipboardWorkflowID is goal 0307's seeded proof: copy an
// id, press the hotkey, paste its SHA-256 -- the one-press
// capture-transform-apply loop on the plain-text clipboard reader and
// the Transform text step.
const ExampleSha256ClipboardWorkflowID = "example-sha256-clipboard-workflow"

func builtInTransformWorkflows() []Workflow {
	const (
		triggerID = "example-sha256-trigger"
		captureID = "example-sha256-capture"
		hashID    = "example-sha256-hash"
		applyID   = "example-sha256-apply"
	)
	nodes, err := ResolveNodeDefaults([]Node{
		{ID: triggerID, NodeTypeID: "trigger-hotkey", Position: Position{X: 0, Y: 0}},
		{ID: captureID, NodeTypeID: "capture-clipboard-text", Position: Position{X: 0, Y: 100}},
		{ID: hashID, NodeTypeID: "process-transform-text", Position: Position{X: 0, Y: 200},
			Config: map[string]string{"operation": "sha256"}},
		{ID: applyID, NodeTypeID: "apply-clipboard-write-text", Position: Position{X: 0, Y: 300}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}
	return []Workflow{{
		ID:          ExampleSha256ClipboardWorkflowID,
		Label:       "Example: SHA-256 the clipboard",
		Description: "Copy an id, press the hotkey, paste its SHA-256. The hash replaces the clipboard text. Ships with no hotkey assigned, so it never fires until you choose a combo on the Hotkey pressed step; the Quick Panel runs it too.",
		Nodes:       nodes,
		Edges: []Edge{
			{ID: "example-sha256-e0", Source: triggerID, Target: captureID},
			{ID: "example-sha256-e1", Source: captureID, Target: hashID},
			{ID: "example-sha256-e2", Source: hashID, Target: applyID},
		},
		BuiltIn: true,
		Seed:    seedorigin.Stamp(2),
	}}
}
