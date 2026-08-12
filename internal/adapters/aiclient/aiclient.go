// Package aiclient executes one AI completion call on behalf of a
// composition ai-* node (docs/goals/0031-ai-node-family.md), against a
// user-configured endpoint -- never autonomously, never in a loop
// (docs/SPEC.md §1.1's locked invariant: "one deterministic call per
// step"). Two wire shapes, one port (Complete): KindOpenAICompat covers
// local Ollama's own /v1 shim plus LM Studio/vLLM/any BYO
// OpenAI-compatible endpoint with zero per-provider code (verified
// directly against Ollama's docs, docs/goals/0031 item 1's research);
// KindAnthropic speaks Anthropic's native Messages API, not its OpenAI
// compat shim -- Anthropic's own docs disqualify that shim for
// production use. Deliberately domain-agnostic (Kind is this package's
// own small type, wire-identical to but distinct from
// internal/domain/aiprovider.Kind, the same "wire-identical, tested"
// convention internal/domain/typedfield.Type already established for
// composition.ConfigFieldType) -- composition.go converts
// aiprovider.Kind to aiclient.Kind at the one call site
// (aiprovider.go's exec functions), keeping this adapter free of any
// domain import, per CLAUDE.md's adapter-boundary rule. Reuses
// internal/adapters/httpconnector for the actual HTTP transport (its
// own 30s timeout + retry policy) rather than a second HTTP client --
// only the request-body/response-parsing shape differs per Kind.
package aiclient

import "fmt"

// Kind mirrors internal/domain/aiprovider.Kind's wire values exactly
// (see this package's own doc comment) -- composition.go is the only
// place that converts between the two.
type Kind string

const (
	KindOpenAICompat Kind = "openai-compatible"
	KindAnthropic    Kind = "anthropic"
)

// SchemaSpec requests structured (JSON) output instead of free text --
// Name is the schema/tool name each wire shape needs (OpenAI's
// response_format.json_schema.name, Anthropic's forced tool name);
// Schema is a raw JSON Schema document describing the desired object
// shape. A nil *SchemaSpec on Request means "plain text completion."
type SchemaSpec struct {
	Name   string
	Schema []byte
}

// Request is one fully-resolved AI completion call.
type Request struct {
	Kind Kind
	// BaseURL is the provider's endpoint. Required for
	// KindOpenAICompat; for KindAnthropic, an empty BaseURL resolves to
	// aiprovider.DefaultAnthropicBaseURL inside the Anthropic adapter
	// (a second, adapter-level default -- see anthropic.go -- so this
	// package alone already does the right thing even if a caller
	// forgets the domain-layer default).
	BaseURL string
	Model   string
	// APIKey is empty for a local, unauthenticated endpoint (e.g.
	// Ollama) -- no Authorization/x-api-key header is sent in that
	// case, never an empty-string header.
	APIKey string
	// System is an optional system-level instruction. Empty means none.
	System string
	// Prompt is the user message -- already composed with any running
	// payload by the calling node (composition.go's composeAIUserContent).
	Prompt string
	// Schema requests structured output when non-nil.
	Schema *SchemaSpec
}

// Result is one completion's outcome. Text is always populated (the
// model's raw text, or -- when Schema was requested -- the structured
// JSON re-serialized as text, so a caller that only wants a string
// never has to branch on whether structured output was requested).
// JSON is populated only when Schema was requested and the provider
// returned a well-formed structured result.
type Result struct {
	Text string
	JSON []byte
}

// Complete dispatches req to the adapter matching req.Kind. The single
// port both ai-completion, ai-extract-structured, and ai-classify call
// through (docs/goals/0031-ai-node-family.md's own "one port, two
// adapters" design).
func Complete(req Request) (Result, error) {
	switch req.Kind {
	case KindOpenAICompat:
		return completeOpenAICompat(req)
	case KindAnthropic:
		return completeAnthropic(req)
	default:
		return Result{}, fmt.Errorf("aiclient: unknown provider kind %q", req.Kind)
	}
}
