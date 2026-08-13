package aiprovider

import "github.com/alicoding/mill/internal/domain/seedorigin"

// ExampleLocalOllamaID is the seeded example AI provider's ID --
// exported so composition.BuiltInWorkflows' own seeded AI examples
// (docs/goals/0031) can reference it without a string literal that
// could drift, same pattern httprequest.ExampleNoneID/
// mcpserver.ExampleReferenceServerID already establish.
const ExampleLocalOllamaID = "example-local-ollama"

// BuiltIn returns the seeded example AI provider -- pure config, no
// persistence (mirrors mcpserver.BuiltIn/execenv.BuiltIn's shape: this
// package stays free of the settings-store concern, per CLAUDE.md's
// backend rule -- ConfigureService owns seeding/top-up).
//
// Points at Ollama's own documented default local port
// (http://localhost:11434, OpenAI-compatible /v1) -- zero-egress and
// works in fully-offline enterprise environments (docs/SPEC.md's own AI-completion row). The
// workflows that reference it (builtinworkflows_ai.go) ship DISABLED,
// same "documented as requiring user setup" precedent
// trigger-filesystem-watch's own seeded example already established --
// a fresh install with no Ollama running gets a real, inspectable
// example rather than a run that fails the moment someone clicks Run.
func BuiltIn() []AIProvider {
	return []AIProvider{
		{
			ID:      ExampleLocalOllamaID,
			Label:   "Local Ollama (localhost:11434)",
			Kind:    KindOpenAICompat,
			BaseURL: "http://localhost:11434",
			Model:   "llama3.2",
			BuiltIn: true,
			Seed:    seedorigin.Stamp(1),
		},
	}
}
