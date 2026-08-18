package composition

import "github.com/alicoding/mill/internal/domain/seedorigin"

// clipboardBuiltInWorkflows seeds the clipboard family: the sample-HTML
// loader and the Clipboard → Markdown pipeline (the app's original
// capability, ending in a completion notification so a hotkey run is
// audible from another app). Split from builtinworkflows.go when that
// file crossed the 500-line limit (.claude/rules/architecture.md).
func clipboardBuiltInWorkflows() []Workflow {
	const loadSampleTriggerID = "load-sample-html-trigger"
	loadSample, err := ResolveNodeDefaults([]Node{
		{ID: loadSampleTriggerID, NodeTypeID: "trigger-manual", Position: Position{X: 0, Y: 0}},
		{ID: "load-sample-html", NodeTypeID: "apply-clipboard-write-html", Position: Position{X: 0, Y: 100}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}

	const (
		triggerID = "clipboard-to-markdown-trigger"
		captureID = "clipboard-to-markdown-capture"
		processID = "clipboard-to-markdown-process"
		applyID   = "clipboard-to-markdown-apply"
		notifyID  = "clipboard-to-markdown-notify"
	)
	clipboardToMarkdown, err := ResolveNodeDefaults([]Node{
		{ID: triggerID, NodeTypeID: "trigger-manual", Position: Position{X: 0, Y: 0}},
		{ID: captureID, NodeTypeID: "capture-clipboard-html", Position: Position{X: 0, Y: 100}},
		{ID: processID, NodeTypeID: "process-html-to-markdown", Position: Position{X: 0, Y: 200}},
		{ID: applyID, NodeTypeID: "apply-clipboard-write-text", Position: Position{X: 0, Y: 300}},
		{ID: notifyID, NodeTypeID: "apply-notify", Position: Position{X: 0, Y: 400},
			Config: map[string]string{"title": "Clipboard → Markdown", "body": "Markdown is on your clipboard — paste away."}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}

	return []Workflow{
		{
			ID:          "load-sample-html-workflow",
			Label:       "Load sample HTML",
			Description: "A single-step workflow: puts real HTML on the clipboard.",
			Nodes:       loadSample,
			Edges: []Edge{
				{ID: "load-sample-html-e1", Source: loadSampleTriggerID, Target: "load-sample-html"},
			},
			BuiltIn: true,
			Seed:    seedorigin.Stamp(1),
		},
		{
			ID:          "clipboard-html-to-markdown-workflow",
			Label:       "Clipboard → Markdown",
			Description: "Capture the clipboard's HTML, convert it to Markdown, write it back, then say so -- the notification is how a hotkey run tells you it finished while you're in another app.",
			Nodes:       clipboardToMarkdown,
			Edges: []Edge{
				{ID: "clipboard-to-markdown-e0", Source: triggerID, Target: captureID},
				{ID: "clipboard-to-markdown-e1", Source: captureID, Target: processID},
				{ID: "clipboard-to-markdown-e2", Source: processID, Target: applyID},
				{ID: "clipboard-to-markdown-e3", Source: applyID, Target: notifyID},
			},
			BuiltIn: true,
			// Rev 2 (goal 0114): the completion notification joined the
			// pipeline.
			Seed: seedorigin.Stamp(2),
		},
	}
}
