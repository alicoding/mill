package composition

import (
	"errors"
	"testing"

	"github.com/alicoding/mill/internal/adapters/aiclient"
)

var errAIStub = errors.New("stubbed AI completion failure")

func withAIStubs(t *testing.T, provider ResolvedAIProvider, complete func(aiclient.Request) (aiclient.Result, error)) {
	t.Helper()
	prevLookup, prevComplete := lookupAIProviderFn, aiCompleteFn
	t.Cleanup(func() { lookupAIProviderFn, aiCompleteFn = prevLookup, prevComplete })
	lookupAIProviderFn = func(id string) (ResolvedAIProvider, error) { return provider, nil }
	aiCompleteFn = complete
}

func TestAICompletionExec_ReplacesPayloadWithCompletionText(t *testing.T) {
	var gotReq aiclient.Request
	withAIStubs(t, ResolvedAIProvider{Kind: "openai-compatible", BaseURL: "http://localhost:11434", Model: "llama3.2"},
		func(req aiclient.Request) (aiclient.Result, error) {
			gotReq = req
			return aiclient.Result{Text: "the summary"}, nil
		})

	exec := lookupNodeType(t, "process-ai-completion")
	node := Node{ID: "n1", NodeTypeID: "process-ai-completion", Config: map[string]string{
		aiProviderIDConfigKey: "p1", "systemPrompt": "be terse", "prompt": "summarize",
	}}
	out, err := exec(node, ExecContext{Payload: "the raw text to summarize"})
	if err != nil {
		t.Fatalf("exec: %v", err)
	}
	if out.Payload != "the summary" {
		t.Errorf("Payload = %q, want %q", out.Payload, "the summary")
	}
	if gotReq.System != "be terse" {
		t.Errorf("System = %q, want %q", gotReq.System, "be terse")
	}
	if want := "summarize\n\nthe raw text to summarize"; gotReq.Prompt != want {
		t.Errorf("Prompt = %q, want %q", gotReq.Prompt, want)
	}
	if gotReq.Model != "llama3.2" {
		t.Errorf("Model = %q, want %q", gotReq.Model, "llama3.2")
	}
}

func TestAICompletionExec_UnresolvableProviderErrorsWithNodePrefix(t *testing.T) {
	prevLookup := lookupAIProviderFn
	t.Cleanup(func() { lookupAIProviderFn = prevLookup })
	exec := lookupNodeType(t, "process-ai-completion")
	node := Node{ID: "n1", NodeTypeID: "process-ai-completion", Config: map[string]string{aiProviderIDConfigKey: "missing"}}
	_, err := exec(node, ExecContext{})
	if err == nil {
		t.Fatal("expected an error for an unresolvable aiproviderId")
	}
	if got := err.Error(); len(got) < len("process-ai-completion: ") || got[:len("process-ai-completion: ")] != "process-ai-completion: " {
		t.Errorf("error %q missing the node's own %q prefix (node-standard error-prefix convention)", got, "process-ai-completion: ")
	}
}

func TestAICompletionExec_CompleteFailureErrorsWithNodePrefix(t *testing.T) {
	withAIStubs(t, ResolvedAIProvider{Model: "m"}, func(aiclient.Request) (aiclient.Result, error) {
		return aiclient.Result{}, errAIStub
	})
	exec := lookupNodeType(t, "process-ai-completion")
	node := Node{ID: "n1", NodeTypeID: "process-ai-completion", Config: map[string]string{aiProviderIDConfigKey: "p1"}}
	_, err := exec(node, ExecContext{})
	if err == nil {
		t.Fatal("expected the stubbed completion failure to propagate")
	}
}

// lookupNodeType returns the registered exec function for id, failing
// the test if it isn't registered -- reaches into nodeTypeRegistry
// directly (registry.go), same package, same pattern other *_test.go
// files in this package already use for white-box access.
func lookupNodeType(t *testing.T, id string) ExecFunc {
	t.Helper()
	entry, ok := nodeTypeRegistry[id]
	if !ok {
		t.Fatalf("node type %q is not registered", id)
	}
	if entry.exec == nil {
		t.Fatalf("node type %q has no registered exec function", id)
	}
	return entry.exec
}
