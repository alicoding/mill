package executionsvc

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// runSeededAIClassifyBranch runs the real seeded "Example: AI classify
// -> branch" workflow (composition.BuiltInWorkflows) through the REAL
// process-ai-classify node and the REAL aiclient.Complete (no
// SetAICompleteFn override) against a local httptest.Server standing in
// for the seed's real localhost:11434 endpoint -- mirrors
// aisummarize_seed_test.go's own fixture-swap pattern exactly. Asserts
// the run reaches SUCCESS with no approval ask (the seed's provider is
// loopback, ClassLocal) and returns the final Attributes so each of the
// two branch-outcome tests can assert on its own expected marker.
func runSeededAIClassifyBranch(t *testing.T, classification string) RunSummary {
	t.Helper()
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	guard := guardrailsvc.NewGuardrailService(store, comp)
	dbPath := filepath.Join(t.TempDir(), "exec.db")
	exec, err := NewExecutionService("sqlite:"+dbPath, comp, guard)
	if err != nil {
		t.Fatalf("NewExecutionService: %v", err)
	}
	t.Cleanup(func() { _ = exec.Shutdown(2 * time.Second) })

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{\"category\":\"` + classification + `\"}"}}]}`))
	}))
	t.Cleanup(srv.Close)

	orig := swapAIProviderLookup(t, func(id string) (composition.ResolvedAIProvider, error) {
		if id != "example-local-ollama" {
			t.Errorf("lookupAIProviderFn called with id %q, want the seed's real aiproviderId %q", id, "example-local-ollama")
		}
		return composition.ResolvedAIProvider{Kind: "openai-compatible", BaseURL: srv.URL, Model: "llama3.2"}, nil
	})
	defer orig()

	wfID := findBuiltInWorkflowID(t, comp, "Example: AI classify -> branch")

	summary, err := exec.RunWorkflow(wfID, RunKindTest, map[string]string{
		"text": "The server is down and customers can't check out.",
	})
	if err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}
	if summary.Status != "SUCCESS" {
		t.Fatalf("RunWorkflow status = %q, want SUCCESS (a loopback AI provider must never park for approval) -- output=%q error=%q", summary.Status, summary.Output, summary.Error)
	}
	return summary
}

func TestSeededAIClassifyBranchExample_UrgentRoutesToUrgentBranch(t *testing.T) {
	summary := runSeededAIClassifyBranch(t, "urgent")
	if !strings.Contains(summary.Output, "routed as URGENT") {
		t.Errorf("Output = %q, want the urgent branch's own marker", summary.Output)
	}
	if strings.Contains(summary.Output, "routed as NORMAL") {
		t.Errorf("Output = %q, want ONLY the urgent branch's marker, not both", summary.Output)
	}
}

func TestSeededAIClassifyBranchExample_NormalRoutesToNormalBranch(t *testing.T) {
	summary := runSeededAIClassifyBranch(t, "normal")
	if !strings.Contains(summary.Output, "routed as NORMAL") {
		t.Errorf("Output = %q, want the normal branch's own marker", summary.Output)
	}
	if strings.Contains(summary.Output, "routed as URGENT") {
		t.Errorf("Output = %q, want ONLY the normal branch's marker, not both", summary.Output)
	}
}
