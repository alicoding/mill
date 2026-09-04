// Package aiprovider holds the core-domain shape of an AIProvider
// (docs/SPEC.md §3.3's AI-completion row, docs/goals/0031): a reusable
// (1:many), Configure-authored connection to a user-configured AI
// endpoint -- local Ollama or a BYO OpenAI-compatible/Anthropic
// endpoint -- that an ai-completion/ai-extract-structured/ai-classify
// workflow node resolves by ID. Mirrors internal/domain/mcpserver's
// shape (a reusable, Configure-authored entity with no auth-strategy
// concept of its own) more than internal/domain/httprequest's -- there
// is exactly one secret slot per provider (the OS keychain, keyed by
// this entity's own ID, resolved server-side, same pattern
// internal/domain/httprequest.AuthType != AuthNone already uses), not
// httprequest's richer AuthType catalogue, since every AI wire shape
// this package's two adapters speak (internal/adapters/aiclient) needs
// at most one bearer-shaped credential. Per CLAUDE.md's core-domain
// rule, the shape and its validation stay hand-written -- no library
// has an opinion on Mill's own AI-provider model.
package aiprovider

import (
	"fmt"
	"strings"
	"time"

	"github.com/alicoding/mill/internal/domain/seedorigin"
	"github.com/alicoding/mill/internal/domain/typedfield"
)

// Kind is a provider's wire-protocol family -- a closed, typed choice
// (execenv.Shell's own "typed choice, not free text" precedent), each
// value dispatched to its own adapter in internal/adapters/aiclient.
// Deliberately just two: docs/goals/0031-ai-node-family.md's own
// research verdict is that every real BYO/local endpoint (Ollama, LM
// Studio, vLLM, OpenAI itself, Groq, ...) speaks the OpenAI-compatible
// /v1/chat/completions shape, and Anthropic's Messages API is the one
// documented exception (its own docs disqualify the OpenAI compat shim
// for production) -- not an extensible plugin registry, since no third
// wire shape is known to exist today (CLAUDE.md's "don't build for a
// decision that doesn't exist yet").
type Kind string

const (
	KindOpenAICompat Kind = "openai-compatible"
	KindAnthropic    Kind = "anthropic"
)

func validKind(k Kind) bool {
	switch k {
	case KindOpenAICompat, KindAnthropic:
		return true
	}
	return false
}

// AIProvider is one reusable, named AI endpoint connection. Carries no
// secret VALUE of its own -- same "the secret itself never lives on
// the domain value" rule httprequest.HTTPRequest/ADR-0007 already
// established. A BYO endpoint's API key (or Anthropic's x-api-key)
// lives in the secret store and this entity names it (KeyRef, goal
// 0306); empty for a local endpoint that needs no credential at all.
type AIProvider struct {
	ID      string
	Label   string
	Kind    Kind
	BaseURL string
	Model   string
	// KeyRef names this endpoint's API key in the secret store (goal
	// 0306) -- a reference (internal/domain/vaultref), never a value.
	// Empty means the endpoint needs no credential, which is the whole
	// configuration for a local one.
	KeyRef string
	// BuiltIn marks a seeded example AIProvider (BuiltIn() below) --
	// purely informational, same as mcpserver.MCPServer.BuiltIn/
	// decision.Decision.BuiltIn/list.List.BuiltIn: drives a "built-in"
	// badge only, never gates Edit/Delete.
	BuiltIn bool
	// CreatedAt/UpdatedAt are system-managed audit timestamps (SPEC.md
	// §3.2.2's reserved-column pattern), stamped server-side at every
	// persisted mutation (ConfigureService), never trusted from the
	// wire. Zero value means pre-timestamp data -- migration-free.
	CreatedAt time.Time
	UpdatedAt time.Time
	// Seed is this provider's seed provenance (docs/goals/0037) -- zero
	// value means "not of seed origin," migration-free. See
	// composition.Workflow.Seed's doc comment for the full reasoning.
	Seed seedorigin.Origin
}

// Fields declares AIProvider's full editable shape (docs/adr/0029) --
// the single source both Validate's required-field pass below and the
// frontend's generic entity-field renderer
// (frontend/src/configure/EntityConfigFields.tsx) read, replacing a
// field list that used to live only as hand-written form JSX. Kind's
// Options are its own wire values (Kind consts below); the frontend
// carries their display text separately (typedfield.Field has no
// per-option display-label facet distinct from an option's wire
// value -- unlike OptionColors, which pairs a presentation facet by
// index, no such facet exists for label text).
var Fields = []typedfield.Field{
	{Key: "label", Label: "Label", Type: typedfield.TypeText, Required: true},
	{Key: "kind", Label: "Kind", Type: typedfield.TypeOptions, Required: true,
		Options: []string{string(KindOpenAICompat), string(KindAnthropic)}},
	{Key: "baseURL", Label: "Base URL", Type: typedfield.TypeText},
	{Key: "model", Label: "Model", Type: typedfield.TypeText, Required: true},
}

// requiredMessages carries Label/Model's exact missing-value wording
// -- Kind and BaseURL are excluded on purpose (see Validate below):
// Kind's blank-vs-invalid cases share one message via validKind, and
// BaseURL's requirement is conditional on Kind, neither of which
// typedfield.ValidateRequired's plain per-field check can express.
var requiredMessages = map[string]string{
	"label": "an AI provider needs a label",
	"model": "an AI provider needs a model name",
}

// Validate checks an AIProvider is well-formed before it's persisted --
// same "never store an unconfigured/invalid value" discipline every
// other Configure entity's own Validate already applies. BaseURL is
// required only for KindOpenAICompat: an Anthropic provider with a
// blank BaseURL resolves against the real api.anthropic.com at call
// time (composition's aiNodeEffectOverride/configuresvc's
// resolveAIProvider), the same "a known single endpoint doesn't force
// the user to retype it" convenience Validate itself doesn't need to
// special-case -- BaseURL blank is legal input for that one Kind.
func Validate(p AIProvider) error {
	values := map[string]string{"label": p.Label, "kind": string(p.Kind), "baseURL": p.BaseURL, "model": p.Model}
	if err := typedfield.ValidateRequired(Fields, values, requiredMessages); err != nil {
		return err
	}
	if !validKind(p.Kind) {
		return fmt.Errorf("an AI provider needs a valid kind (got %q)", p.Kind)
	}
	if p.Kind == KindOpenAICompat && strings.TrimSpace(p.BaseURL) == "" {
		return fmt.Errorf("an OpenAI-compatible AI provider needs a base URL (e.g. http://localhost:11434 for local Ollama)")
	}
	return nil
}

// DefaultAnthropicBaseURL is Anthropic's own real Messages API host --
// used both by configuresvc's resolveAIProvider (a provider saved with
// a blank BaseURL resolves here at call time) and by
// internal/adapters/aiclient's Anthropic adapter as its own last-resort
// default, so either layer alone already does the right thing.
const DefaultAnthropicBaseURL = "https://api.anthropic.com"
