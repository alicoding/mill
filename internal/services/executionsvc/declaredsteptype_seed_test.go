package executionsvc

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/declaredsteptype"
	"github.com/alicoding/mill/internal/domain/httprequest"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// docs/goals/0054 slice A (ADR-0037): the declared-step-type registry's
// own seeded proof, mirroring guardedhttp_seed_test.go's own real-DBOS-
// runtime, real-HTTP-round-trip bar for the raw integration-http node.
// This test additionally reproduces main.go's own two-phase
// construction order (CompositionService before the declared-type
// provider is wired, then CompositionService.ReconcileBuiltIns a
// second time) rather than wiring the provider up front, so it proves
// the ACTUAL production ordering -- not just that ExecuteWorkflow can
// run a declared-type node once handed a resolvable one.

// declaredStepTypeGoldenBindings mirrors configuresvc's own
// declaredStepBindings() conversion (configuredeclaredsteptype.go) --
// duplicated here in test-only code since this package's seed tests
// deliberately bypass ConfigureService entirely
// (compositionsvc.NewCompositionService alone, this file's own header
// comment / guardedhttp_seed_test.go's precedent), the same
// "reconstruct fixture data directly rather than reach into another
// package's private helper" shape those tests already use for their
// own ResolvedHTTPRequest fixtures.
func declaredStepTypeGoldenBindings() []composition.DeclaredStepBinding {
	out := make([]composition.DeclaredStepBinding, 0, 1)
	for _, d := range declaredsteptype.BuiltIn() {
		pinned := make(map[string]string, len(d.PinnedConfig)+1)
		for k, v := range d.PinnedConfig {
			pinned[k] = v
		}
		hidden := make([]string, 0, len(d.HiddenFields)+len(d.EngineFields()))
		hidden = append(hidden, d.HiddenFields...)
		for k, v := range d.EngineFields() {
			pinned[k] = v
			hidden = append(hidden, k)
		}
		out = append(out, composition.DeclaredStepBinding{
			ID: d.ID, Label: d.Label, Description: d.Description,
			EngineNodeTypeID: d.EngineNodeTypeID(),
			PinnedConfig:     pinned, HiddenFields: hidden,
		})
	}
	return out
}

func TestSeededDeclaredStepTypeExample_ApproveFiresRealHTTPCallThroughTheDeclaredType(t *testing.T) {
	store := servicetest.NewFakeStore()
	// composition.declaredNodeTypeLookupFn is process-global state
	// (declaredsteptype.go): another test in this same binary
	// (decisionoutcome_seed_test.go constructs a real
	// configuresvc.ConfigureService) may have already wired it with
	// real bindings and left it wired, the same "the last wirer's state
	// is what production actually has" shape this whole injected-seam
	// pattern already carries throughout the suite. Reset to the
	// unwired default explicitly so this test's own precondition --
	// CompositionService's first BuiltInWorkflows() pass genuinely
	// cannot resolve the declared type yet -- holds regardless of test
	// order, reproducing main.go's real construction order rather than
	// depending on it accidentally.
	composition.SetDeclaredNodeTypeLookup(nil)
	comp := compositionsvc.NewCompositionService(store)

	// The seeded workflow must be ABSENT at this point: proves this
	// test isn't accidentally exercising a stale global-state leak from
	// an earlier test rather than the real ordering hazard
	// builtinworkflows_declaredsteptype.go's own doc comment names.
	for _, wf := range comp.Workflows() {
		if wf.Label == "Example: Declared step type" {
			t.Fatal(`"Example: Declared step type" is already present before the declared-type provider is wired -- the ordering-hazard precondition this test relies on doesn't hold`)
		}
	}

	t.Cleanup(func() { composition.SetDeclaredNodeTypeLookup(nil) })
	composition.SetDeclaredNodeTypeLookup(declaredStepTypeGoldenBindings)
	comp.ReconcileBuiltIns()

	wfID := findBuiltInWorkflowID(t, comp, "Example: Declared step type")

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
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	orig := swapHTTPRequestLookup(t, func(id string) (composition.ResolvedHTTPRequest, error) {
		if id != httprequest.ExampleNoneID {
			t.Errorf("lookupHTTPRequestFn called with id %q, want the declared type's pinned requestId %q", id, httprequest.ExampleNoneID)
		}
		return composition.ResolvedHTTPRequest{BaseURL: srv.URL, AuthType: httprequest.AuthNone}, nil
	})
	defer orig()

	summary, err := exec.RunWorkflow(wfID, RunKindTest, nil)
	if err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}

	// The declared type inherits integration-http's ClassExternal Effect
	// verbatim (ADR-0037: a declaration can never weaken gating) -- the
	// run must park awaiting approval, exactly like a raw integration-http
	// node would.
	pending := waitFor(t, "pending approval", 10*time.Second, func() (*PendingApproval, bool) {
		s, err := exec.summaryFor(summary.RunID)
		if err != nil || s.Pending == nil {
			return nil, false
		}
		return s.Pending, true
	})
	if pending.NodeTypeID != declaredsteptype.ExampleCheckHTTPBinID {
		t.Fatalf("pending.NodeTypeID = %q, want the declared step type's own id %q", pending.NodeTypeID, declaredsteptype.ExampleCheckHTTPBinID)
	}

	if err := exec.ResolveApproval(summary.RunID, pending.NodeID, true, nil, false); err != nil {
		t.Fatalf("ResolveApproval(approve): %v", err)
	}

	final := waitFor(t, "run to succeed", 10*time.Second, func() (RunSummary, bool) {
		s, err := exec.summaryFor(summary.RunID)
		if err != nil || s.Status != "SUCCESS" {
			return RunSummary{}, false
		}
		return s, true
	})
	if final.Output != `{"ok":true}` {
		t.Errorf("final.Output = %q, want the fake server's response body", final.Output)
	}
	if calls := atomic.LoadInt32(&hits); calls != 1 {
		t.Errorf("fake server received %d hits, want exactly 1", calls)
	}
}
