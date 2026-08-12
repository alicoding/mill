package composition

import (
	"fmt"
	"testing"

	"github.com/alicoding/mill/internal/domain/guardrail"
)

func TestIsLocalAIHost(t *testing.T) {
	cases := map[string]bool{
		"http://localhost:11434":     true,
		"http://localhost":           true,
		"https://LOCALHOST:11434":    true, // case-insensitive host
		"http://127.0.0.1:11434":     true,
		"http://127.0.0.1":           true,
		"http://[::1]:11434":         true, // IPv6 brackets + port
		"http://[::1]":               true,
		"localhost:11434":            true, // bare host:port, no scheme
		"127.0.0.1":                  true,
		"http://api.openai.com":      false,
		"https://api.anthropic.com":  false,
		"http://127.0.0.2":           false, // narrow allow-list, not a /8 CIDR (goal's own literal wording)
		"http://0.0.0.0:11434":       false,
		"http://my-localhost.local":  false, // substring, not the exact host
		"http://internal-ollama:11434": false,
		"":                           false,
		"not a url at all ://":       false,
	}
	for baseURL, want := range cases {
		if got := isLocalAIHost(baseURL); got != want {
			t.Errorf("isLocalAIHost(%q) = %v, want %v", baseURL, got, want)
		}
	}
}

func TestComposeAIUserContent(t *testing.T) {
	cases := []struct{ prompt, payload, want string }{
		{"summarize this", "the payload text", "summarize this\n\nthe payload text"},
		{"summarize this", "", "summarize this"},
		{"", "just the payload", "just the payload"},
		{"", "", ""},
	}
	for _, c := range cases {
		if got := composeAIUserContent(c.prompt, c.payload); got != c.want {
			t.Errorf("composeAIUserContent(%q, %q) = %q, want %q", c.prompt, c.payload, got, c.want)
		}
	}
}

func TestAINodeEffectOverride_NonAINodeFallsThrough(t *testing.T) {
	_, ok := aiNodeEffectOverride(Node{NodeTypeID: "integration-http"})
	if ok {
		t.Error("expected a non-AI node type to fall through (ok=false)")
	}
}

func TestAINodeEffectOverride_UnresolvableProviderFallsThroughFailSafe(t *testing.T) {
	prev := lookupAIProviderFn
	t.Cleanup(func() { lookupAIProviderFn = prev })
	lookupAIProviderFn = func(id string) (ResolvedAIProvider, error) {
		return ResolvedAIProvider{}, fmt.Errorf("no such provider")
	}
	_, ok := aiNodeEffectOverride(Node{NodeTypeID: "process-ai-completion", Config: map[string]string{"aiproviderId": "missing"}})
	if ok {
		t.Error("an unresolvable AI provider must fall through to the static ClassExternal, never silently downgrade")
	}
}

func TestAINodeEffectOverride_LocalhostDowngradesToClassLocal(t *testing.T) {
	prev := lookupAIProviderFn
	t.Cleanup(func() { lookupAIProviderFn = prev })
	lookupAIProviderFn = func(id string) (ResolvedAIProvider, error) {
		return ResolvedAIProvider{BaseURL: "http://localhost:11434"}, nil
	}
	class, ok := aiNodeEffectOverride(Node{NodeTypeID: "process-ai-completion", Config: map[string]string{"aiproviderId": "p1"}})
	if !ok || class != guardrail.ClassLocal {
		t.Errorf("expected (ClassLocal, true) for a loopback provider, got (%v, %v)", class, ok)
	}
}

func TestAINodeEffectOverride_RemoteHostFallsThroughToStaticExternal(t *testing.T) {
	prev := lookupAIProviderFn
	t.Cleanup(func() { lookupAIProviderFn = prev })
	lookupAIProviderFn = func(id string) (ResolvedAIProvider, error) {
		return ResolvedAIProvider{BaseURL: "https://api.anthropic.com"}, nil
	}
	_, ok := aiNodeEffectOverride(Node{NodeTypeID: "process-ai-classify", Config: map[string]string{"aiproviderId": "p1"}})
	if ok {
		t.Error("expected a remote provider to fall through to the static NodeTypeEffect (ClassExternal)")
	}
}

// TestEffectForNode_AICompletionLocalhost proves the full EffectForNode
// dispatch (decisionoutcome.go), not just the override helper in
// isolation -- a loopback AI provider's node reports ClassLocal end to
// end, exactly what the guardrail gate itself calls.
func TestEffectForNode_AICompletionLocalhost(t *testing.T) {
	prev := lookupAIProviderFn
	t.Cleanup(func() { lookupAIProviderFn = prev })
	lookupAIProviderFn = func(id string) (ResolvedAIProvider, error) {
		return ResolvedAIProvider{BaseURL: "http://127.0.0.1:11434"}, nil
	}
	got := EffectForNode(Node{NodeTypeID: "process-ai-completion", Config: map[string]string{"aiproviderId": "p1"}})
	if got != guardrail.ClassLocal {
		t.Errorf("EffectForNode = %v, want ClassLocal", got)
	}
}

func TestEffectForNode_AICompletionRemoteStaysExternal(t *testing.T) {
	prev := lookupAIProviderFn
	t.Cleanup(func() { lookupAIProviderFn = prev })
	lookupAIProviderFn = func(id string) (ResolvedAIProvider, error) {
		return ResolvedAIProvider{BaseURL: "https://api.openai.com"}, nil
	}
	got := EffectForNode(Node{NodeTypeID: "process-ai-completion", Config: map[string]string{"aiproviderId": "p1"}})
	if got != guardrail.ClassExternal {
		t.Errorf("EffectForNode = %v, want ClassExternal (static NodeTypeEffect)", got)
	}
}
