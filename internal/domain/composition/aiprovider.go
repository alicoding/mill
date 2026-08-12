package composition

import (
	"fmt"
	"net/url"
	"strings"

	"github.com/alicoding/mill/internal/domain/aiprovider"
	"github.com/alicoding/mill/internal/domain/guardrail"
)

// ResolvedAIProvider is an AIProvider's config plus its decrypted
// secret (if any), assembled by whatever owns AIProvider storage at
// request time -- same seam shape as ResolvedHTTPRequest/
// ResolvedMCPServer/ResolvedDecision: composition.go doesn't own
// AIProvider persistence (ConfigureService does), so this is injected
// once via SetAIProviderLookup rather than composition depending on
// ConfigureService directly.
type ResolvedAIProvider struct {
	Kind    aiprovider.Kind
	BaseURL string
	Model   string
	// APIKey is empty for a local, unauthenticated endpoint (e.g.
	// Ollama) -- resolveAIProvider (configuresvc) only hits the OS
	// keychain at all when a secret was actually stored.
	APIKey string
}

// lookupAIProviderFn defaults to erroring so an ai-* node run before
// ConfigureService exists (or before SetAIProviderLookup wires it)
// fails loudly instead of silently no-op'ing -- same pattern every
// other lookup*Fn in this package already uses.
var lookupAIProviderFn = func(id string) (ResolvedAIProvider, error) {
	return ResolvedAIProvider{}, fmt.Errorf("no AI provider lookup registered (yet) for id %q", id)
}

// SetAIProviderLookup wires the function every ai-* node (and
// EffectForNode's dynamic-effect hook below) uses to resolve an
// aiproviderId into its endpoint/model/secret. Called once from
// main.go once ConfigureService exists.
func SetAIProviderLookup(fn func(id string) (ResolvedAIProvider, error)) {
	lookupAIProviderFn = fn
}

// composeAIUserContent implements every ai-* node's shared
// prompt+payload composition rule (docs/goals/0031-ai-node-family.md:
// "user content = prompt + payload"), documented once here rather than
// copy-pasted per node. A blank payload (e.g. a trigger-manual run with
// nothing captured yet) leaves prompt untouched -- no trailing
// separator with nothing after it.
func composeAIUserContent(prompt, payload string) string {
	if payload == "" {
		return prompt
	}
	if prompt == "" {
		return payload
	}
	return prompt + "\n\n" + payload
}

// aiNodeTypeIDs are the AI node family's three members (docs/goals/0031)
// -- the set aiNodeEffectOverride below applies its localhost downgrade
// to. A map, not a per-file registration, since the override logic
// itself (not each node's own RegisterNodeType call) is what needs to
// know the full family.
var aiNodeTypeIDs = map[string]bool{
	"process-ai-completion":         true,
	"process-ai-extract-structured": true,
	"process-ai-classify":           true,
}

// aiProviderIDConfigKey is every AI node's own ConfigField key for its
// aiproviderId reference -- one shared constant so the three node files
// and this override never drift on the literal string.
const aiProviderIDConfigKey = "aiproviderId"

// isLocalAIHost reports whether baseURL's host is EXACTLY localhost,
// 127.0.0.1, or ::1 (docs/goals/0031-ai-node-family.md's owner-ratified
// Effect design: "downgrade to ClassLocal when the resolved
// AIProvider.BaseURL host is exactly localhost/127.0.0.1/[::1]" -- a
// narrow, explicit allow-list, not a broader 127.0.0.0/8 loopback CIDR
// check, matching the goal's own literal wording). url.Parse +
// u.Hostname() handles every documented edge case without hand-rolled
// string surgery: a port suffix ("localhost:11434"), IPv6 brackets
// ("[::1]:11434" -- Hostname() strips both the brackets and the port),
// and a bare host with no scheme (tolerated by prefixing "http://"
// before parsing, since url.Parse without a scheme treats the whole
// string as an opaque path, not a host).
func isLocalAIHost(baseURL string) bool {
	raw := baseURL
	if !strings.Contains(raw, "://") {
		raw = "http://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil {
		return false
	}
	switch strings.ToLower(u.Hostname()) {
	case "localhost", "127.0.0.1", "::1":
		return true
	default:
		return false
	}
}

// aiNodeEffectOverride implements EffectForNode's (decisionoutcome.go)
// per-AI-node dynamic downgrade: an AI node's static Effect is
// ClassExternal (every ai-* NodeType's own RegisterNodeType call,
// consistent with integration-http/mcp-tool-call's local-subprocess
// precedent -- a remote/BYO AI call asks for approval by default), but
// a node whose resolved AIProvider points at a loopback BaseURL
// downgrades to ClassLocal so local Ollama stays frictionless
// (docs/SPEC.md §1's not-harder-than-baseline invariant). Returns
// ok=false (falls through to the static ClassExternal) for any
// non-AI node, and -- fail-safe -- for an AI node whose provider can't
// be resolved at all: an unresolvable reference still asks, it never
// silently downgrades.
func aiNodeEffectOverride(node Node) (guardrail.EffectClass, bool) {
	if !aiNodeTypeIDs[node.NodeTypeID] {
		return "", false
	}
	rp, err := lookupAIProviderFn(node.Config[aiProviderIDConfigKey])
	if err != nil {
		return "", false
	}
	if isLocalAIHost(rp.BaseURL) {
		return guardrail.ClassLocal, true
	}
	return "", false
}
