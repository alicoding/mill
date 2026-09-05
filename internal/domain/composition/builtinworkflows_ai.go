package composition

import (
	"github.com/alicoding/mill/internal/domain/aiprovider"
	"github.com/alicoding/mill/internal/domain/seedorigin"
)

// builtInAIWorkflows are the AI node family's seeded proof
// (docs/goals/0031-ai-node-family.md item 4, .claude/rules/testing.md's
// "every capability ships a seeded example" spine): a runnable,
// inspectable demonstration of process-ai-completion, referencing the
// seeded aiprovider.ExampleLocalOllamaID AIProvider. Ships DISABLED --
// the same "documented as requiring user setup" precedent
// trigger-filesystem-watch's own seeded example established -- a fresh
// install with no Ollama running gets a real example to inspect and
// enable, not a Run button that fails the moment it's clicked. Sources
// its text from a declared "text" Attribute (capture-attribute), not
// the clipboard: docs/SPEC.md §1.3/.claude/rules/testing.md document
// real-pasteboard access as CI-unsafe even on macOS runners (no GUI/
// pasteboard session for osascript headlessly) -- an Attribute keeps
// this seed's own Go proof test (executionsvc) fully deterministic,
// while still exercising the exact same prompt+payload composition a
// clipboard-sourced payload would. Split into its own file (mirrors
// builtinworkflows_list.go/builtinworkflows_systemevent.go's own split
// reasoning): this file was the newest, self-contained addition once
// BuiltInWorkflows() neared the 500-line convention.
func builtInAIWorkflows() []Workflow {
	const (
		summarizeTriggerID = "example-ai-summarize-trigger"
		summarizeCaptureID = "example-ai-summarize-capture"
		summarizeStepID    = "example-ai-summarize-step"
	)
	summarizeNodes, err := ResolveNodeDefaults([]Node{
		{ID: summarizeTriggerID, NodeTypeID: "trigger-manual", Position: Position{X: 0, Y: 0}},
		{ID: summarizeCaptureID, NodeTypeID: "capture-attribute", Position: Position{X: 0, Y: 100},
			Config: map[string]string{"attribute": "text"}},
		{ID: summarizeStepID, NodeTypeID: "process-ai-completion", Position: Position{X: 0, Y: 200},
			Config: map[string]string{
				aiProviderIDConfigKey: aiprovider.ExampleLocalOllamaID,
				"systemPrompt":        "You are a concise summarizer. Reply with plain text only, no markdown.",
				"prompt":              "Summarize the following in two sentences:",
			}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}

	// "Triage a client email" -- THE decisioning composition
	// docs/goals/0031-ai-node-family.md names explicitly: ai-classify
	// writes a category into an Attribute, and Branch (decision-route)
	// routes on it, same "capture -> AI step -> guarded action" shape
	// the goal's own Acceptance criterion describes. Two categories
	// ("urgent"/"normal") keep the example legible; each branch ends in
	// a visible process-inject-text marker so a real run's outcome is
	// obvious without needing a second Configure entity (a Decision)
	// just to demonstrate routing.
	const (
		classifyTriggerID = "example-ai-classify-trigger"
		classifyCaptureID = "example-ai-classify-capture"
		classifyStepID    = "example-ai-classify-step"
		classifyRouteID   = "example-ai-classify-route"
		classifyUrgentID  = "example-ai-classify-urgent"
		classifyNormalID  = "example-ai-classify-normal"
	)
	classifyNodes, err := ResolveNodeDefaults([]Node{
		{ID: classifyTriggerID, NodeTypeID: "trigger-manual", Position: Position{X: 0, Y: 0}},
		{ID: classifyCaptureID, NodeTypeID: "capture-attribute", Position: Position{X: 0, Y: 100},
			Config: map[string]string{"attribute": "text"}},
		{ID: classifyStepID, NodeTypeID: "process-ai-classify", Position: Position{X: 0, Y: 200},
			Config: map[string]string{
				aiProviderIDConfigKey: aiprovider.ExampleLocalOllamaID,
				"instruction":         "Classify this support message as urgent or normal.",
				"categories":          "urgent\nnormal",
				"outputAttribute":     "category",
			}},
		{ID: classifyRouteID, NodeTypeID: "decision-route", Position: Position{X: 0, Y: 300}},
		{ID: classifyUrgentID, NodeTypeID: "process-inject-text", Position: Position{X: -120, Y: 400},
			Config: map[string]string{"text": "(routed as URGENT)", "placement": "append"}},
		{ID: classifyNormalID, NodeTypeID: "process-inject-text", Position: Position{X: 120, Y: 400},
			Config: map[string]string{"text": "(routed as NORMAL)", "placement": "append"}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}

	return []Workflow{
		{
			ID:          "example-ai-summarize-workflow",
			Label:       "Summarize a client email",
			Description: "Sends the email text to the local model for a two-sentence summary.",
			Nodes:       summarizeNodes,
			Edges: []Edge{
				{ID: "example-ai-summarize-e0", Source: summarizeTriggerID, Target: summarizeCaptureID},
				{ID: "example-ai-summarize-e1", Source: summarizeCaptureID, Target: summarizeStepID},
			},
			Attributes: []AttributeDef{{Key: "text", Label: "Text to summarize", Type: FieldText, Description: "The text this workflow summarizes. Bind a real value via a test run, or wire an upstream step to set it."}},
			BuiltIn:    true,
			Seed:       seedorigin.Stamp(4),
			Disabled:   true,
		},
		{
			ID:          "example-ai-classify-branch-workflow",
			Label:       "Triage a client email",
			Description: "Classifies the email as urgent or normal and branches on the result.",
			Nodes:       classifyNodes,
			Edges: []Edge{
				{ID: "example-ai-classify-e0", Source: classifyTriggerID, Target: classifyCaptureID},
				{ID: "example-ai-classify-e1", Source: classifyCaptureID, Target: classifyStepID},
				{ID: "example-ai-classify-e2", Source: classifyStepID, Target: classifyRouteID},
				{ID: "example-ai-classify-e3", Source: classifyRouteID, SourceHandle: `category == "urgent"`, Target: classifyUrgentID},
				{ID: "example-ai-classify-e4", Source: classifyRouteID, SourceHandle: otherwiseHandle, Target: classifyNormalID},
			},
			Attributes: []AttributeDef{
				{Key: "text", Label: "Text to classify", Type: FieldText, Description: "The support message this workflow classifies. Bind a real value via a test run, or wire an upstream step to set it."},
				{Key: "category", Label: "Category (written by AI: Classify)", Type: FieldText, Description: "The chosen category, written by the AI: Classify step and read by the Branch below."},
			},
			BuiltIn:  true,
			Seed:     seedorigin.Stamp(4),
			Disabled: true,
		},
	}
}
