package executionsvc

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// TestSeededAISummarizeExample_RunsEndToEndAgainstFixtureEndpoint runs
// the REAL seeded "Example: Summarize with local AI" workflow
// (composition.BuiltInWorkflows) through the REAL process-ai-completion
// node and the REAL internal/adapters/aiclient.Complete (no
// SetAICompleteFn override) against a local httptest.Server speaking
// the OpenAI-compatible /v1/chat/completions wire shape -- the
// deterministic, no-real-model CI proof layer docs/goals/0031-ai-node-
// family.md item 4 asks for. Also proves the seed's own localhost
// AIProvider gets ClassLocal (no approval ask): the run completes
// SUCCESS synchronously, never parks pending an approval the way
// guardedhttp_seed_test.go's remote-endpoint seed does.
func TestSeededAISummarizeExample_RunsEndToEndAgainstFixtureEndpoint(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	guard := guardrailsvc.NewGuardrailService(store, comp)
	dbPath := filepath.Join(t.TempDir(), "exec.db")
	exec, err := NewExecutionService("sqlite:"+dbPath, comp, guard)
	if err != nil {
		t.Fatalf("NewExecutionService: %v", err)
	}
	t.Cleanup(func() { _ = exec.Shutdown(2 * time.Second) })

	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		if r.URL.Path != "/v1/chat/completions" {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"Mill captures, transforms, and safely applies data. A guardrail gates every external step."}}]}`))
	}))
	defer srv.Close()

	orig := swapAIProviderLookup(t, func(id string) (composition.ResolvedAIProvider, error) {
		if id != "example-local-ollama" {
			t.Errorf("lookupAIProviderFn called with id %q, want the seed's real aiproviderId %q", id, "example-local-ollama")
		}
		// The seed's REAL AIProvider points at localhost:11434 -- this
		// test substitutes the fixture server's URL for the actual HTTP
		// target (same "swap the lookup, keep the real transport"
		// pattern guardedhttp_seed_test.go uses), but Kind/Model mirror
		// what aiprovider.BuiltIn() really ships.
		return composition.ResolvedAIProvider{Kind: "openai-compatible", BaseURL: srv.URL, Model: "llama3.2"}, nil
	})
	defer orig()

	wfID := findBuiltInWorkflowID(t, comp, "Example: Summarize with local AI")

	summary, err := exec.RunWorkflow(wfID, RunKindTest, map[string]string{
		"text": "Mill is a guardrailed, local-first workflow automation tool.",
	})
	if err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}
	if summary.Status != "SUCCESS" {
		t.Fatalf("RunWorkflow status = %q, want SUCCESS (a loopback AI provider must never park for approval) -- output=%q error=%q", summary.Status, summary.Output, summary.Error)
	}
	if !strings.Contains(summary.Output, "Mill captures, transforms") {
		t.Errorf("summary.Output = %q, want the fixture's completion text", summary.Output)
	}
	if calls := atomic.LoadInt32(&hits); calls != 1 {
		t.Errorf("fixture server received %d requests, want exactly 1", calls)
	}
}

// swapAIProviderLookup installs fn as composition's AI-provider lookup
// seam and returns a restore function -- mirrors
// guardedhttp_seed_test.go's swapHTTPRequestLookup exactly.
func swapAIProviderLookup(t *testing.T, fn func(id string) (composition.ResolvedAIProvider, error)) func() {
	t.Helper()
	composition.SetAIProviderLookup(fn)
	return func() {
		composition.SetAIProviderLookup(func(id string) (composition.ResolvedAIProvider, error) {
			return composition.ResolvedAIProvider{}, fmt.Errorf("no AI provider lookup registered (yet) for id %q", id)
		})
	}
}
