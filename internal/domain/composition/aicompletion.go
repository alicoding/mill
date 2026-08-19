package composition

import (
	"fmt"

	"github.com/alicoding/mill/internal/adapters/aiclient"
	"github.com/alicoding/mill/internal/domain/guardrail"
)

// aiCompleteFn is the function process-ai-completion actually calls to
// perform the AI request -- defaults to aiclient.Complete, a real HTTP
// call (production's only path). Overridable in tests (SetAICompleteFn)
// so this node's own responsibility -- resolving the provider, composing
// the prompt, applying the result to the payload -- can be proven
// without hitting real HTTP, mirroring mcpcall.go's callToolFn/
// SetMCPCallTool precedent exactly. The e2e/seeded proof
// (docs/goals/0031-ai-node-family.md item 4) instead runs the REAL
// aiclient.Complete against an httptest fixture server, proving the
// full stack including this default.
var aiCompleteFn = aiclient.Complete

// SetAICompleteFn overrides how the AI node family actually performs a
// completion call -- test-only; production always uses the default
// (aiclient.Complete). Shared by all three ai-* nodes (ai-completion
// today; ai-extract-structured/ai-classify reuse the same var).
func SetAICompleteFn(fn func(aiclient.Request) (aiclient.Result, error)) {
	aiCompleteFn = fn
}

func init() {
	RegisterNodeType(NodeType{
		ID: "process-ai-completion", Kind: KindProcess,
		Effect:      guardrail.ClassExternal, // dynamic downgrade for a loopback provider -- aiprovider.go's aiNodeEffectOverride, dispatched via EffectForNode
		Complexity:  ComplexityBasic,
		Consumes:    []PayloadKind{PayloadText, PayloadNone},
		Produces:    PayloadProduce{Kind: PayloadText},
		Output:      "the AI completion text, replacing the payload",
		Label:       "Generate with AI",
		Description: "Sends a prompt plus the payload to a configured AI provider -- local Ollama, or your own OpenAI-compatible or Anthropic endpoint -- and replaces the payload with the completion. The system prompt is this step's System prompt field; the user message is the Prompt followed by the payload when one exists. One call per run, never a loop.",
		ConfigFields: []ConfigField{
			{
				Key: aiProviderIDConfigKey, Label: "AI provider",
				Description: "Which Configure-authored AI provider (local Ollama or a BYO endpoint) this step calls.",
				Default:     "", Type: FieldText, RefKind: "aiprovider",
			},
			{
				Key: "systemPrompt", Label: "System prompt", Multiline: true,
				Description: "Optional system-level instruction sent ahead of the user message. Leave empty for none.",
				Default:     "", Type: FieldText,
			},
			{
				Key: "prompt", Label: "Prompt", Multiline: true,
				Description: "The instruction sent as the user message, followed by the current payload (if any).",
				Default:     "", Type: FieldText,
			},
		},
	}, func(node Node, ctx ExecContext) (ExecContext, error) {
		rp, err := lookupAIProviderFn(node.Config[aiProviderIDConfigKey])
		if err != nil {
			return ctx, fmt.Errorf("process-ai-completion: %w", err)
		}
		result, err := aiCompleteFn(aiclient.Request{
			Kind:    aiclient.Kind(rp.Kind),
			BaseURL: rp.BaseURL,
			Model:   rp.Model,
			APIKey:  rp.APIKey,
			System:  node.Config["systemPrompt"],
			Prompt:  composeAIUserContent(node.Config["prompt"], ctx.Payload),
		})
		if err != nil {
			return ctx, fmt.Errorf("process-ai-completion: %w", err)
		}
		ctx.Payload = result.Text
		return ctx, nil
	})
}
