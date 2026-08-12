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

	return []Workflow{
		{
			ID:          "example-ai-summarize-workflow",
			Label:       "Example: Summarize with local AI",
			Description: "Reads this workflow's declared \"text\" Attribute and sends it to a local Ollama endpoint (Configure > AI Providers > \"Local Ollama (localhost:11434)\") for a two-sentence summary. Ships DISABLED and requires a real Ollama install (https://ollama.com) running the seeded provider's model locally -- enable this workflow once Ollama is running, or point the AI provider at your own BYO endpoint instead. Demonstrates process-ai-completion's own prompt+payload composition (docs/goals/0031-ai-node-family.md): the system prompt sets tone, the user message is this node's Prompt followed by the captured text.",
			Nodes:       summarizeNodes,
			Edges: []Edge{
				{ID: "example-ai-summarize-e0", Source: summarizeTriggerID, Target: summarizeCaptureID},
				{ID: "example-ai-summarize-e1", Source: summarizeCaptureID, Target: summarizeStepID},
			},
			Attributes: []AttributeDef{{Key: "text", Label: "Text to summarize", Type: FieldText, Description: "The text this workflow summarizes -- bind a real value via a test run, or wire an upstream step to set it."}},
			BuiltIn:    true,
			Seed:       seedorigin.Stamp(1),
			Disabled:   true,
		},
	}
}
