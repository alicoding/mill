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
	"github.com/alicoding/mill/internal/domain/httprequest"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// docs/goals/0010 item 1: the audit found every existing guardrail Go
// test (executionservice_guardrail_test.go) runs a look-alike
// "test-external-echo" fixture node, never the REAL seeded
// "example-guarded-http-workflow" (composition.BuiltInWorkflows). These
// two tests close that gap by running the actual seed against a real
// DBOS runtime, covering both halves of ADR-0022's ask flow: deny fails
// closed with no HTTP call ever made, approve genuinely fires one.

// TestSeededGuardedHTTPWorkflow_DenyFailsClosed_NoHTTPCall proves the
// real seed's deny path parks then fails closed, and that the deny
// itself never reaches lookupHTTPRequestFn at all -- the guardrail gate
// runs BEFORE the node executes, so a denied external step must never
// even resolve its HTTPRequest, let alone call it. Asserted via a
// lookup seam that fails the test if it's ever invoked (SPEC.md §1.2's
// "verify, don't assume" discipline applied to "no network happened").
func TestSeededGuardedHTTPWorkflow_DenyFailsClosed_NoHTTPCall(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	guard := guardrailsvc.NewGuardrailService(store, comp)
	dbPath := filepath.Join(t.TempDir(), "exec.db")
	exec, err := NewExecutionService("sqlite:"+dbPath, comp, guard)
	if err != nil {
		t.Fatalf("NewExecutionService: %v", err)
	}
	t.Cleanup(func() { _ = exec.Shutdown(2 * time.Second) })

	var lookupCalls int32
	orig := swapHTTPRequestLookup(t, func(id string) (composition.ResolvedHTTPRequest, error) {
		atomic.AddInt32(&lookupCalls, 1)
		t.Errorf("lookupHTTPRequestFn was called with id %q on the DENY path -- a denied external step must never resolve/call its integration", id)
		return composition.ResolvedHTTPRequest{}, nil
	})
	defer orig()

	wfID := findBuiltInWorkflowID(t, comp, "Post an update to the client portal")

	summary, err := exec.RunWorkflow(wfID, RunKindTest, nil)
	if err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}
	if summary.Status == "SUCCESS" || summary.Status == "ERROR" {
		t.Fatalf("run should still be in flight (parked), got status %s", summary.Status)
	}

	pending := waitFor(t, "pending approval", 10*time.Second, func() (*PendingApproval, bool) {
		s, err := exec.summaryFor(summary.RunID)
		if err != nil || s.Pending == nil {
			return nil, false
		}
		return s.Pending, true
	})
	if pending.NodeTypeID != "integration-http" {
		t.Fatalf("pending.NodeTypeID = %q, want integration-http", pending.NodeTypeID)
	}

	if err := exec.ResolveApproval(summary.RunID, pending.NodeID, false, nil, false); err != nil {
		t.Fatalf("ResolveApproval(deny): %v", err)
	}

	final := waitFor(t, "run to fail", 10*time.Second, func() (RunSummary, bool) {
		s, err := exec.summaryFor(summary.RunID)
		if err != nil || (s.Status != "ERROR" && s.Status != "MAX_RECOVERY_ATTEMPTS_EXCEEDED") {
			return RunSummary{}, false
		}
		return s, true
	})
	if !strings.Contains(final.Error, "denied by user") {
		t.Fatalf("final.Error = %q, want a denied-by-user guardrail error", final.Error)
	}
	if calls := atomic.LoadInt32(&lookupCalls); calls != 0 {
		t.Errorf("lookupHTTPRequestFn was called %d times on the deny path, want 0 -- no HTTP call may ever fire for a denied step", calls)
	}
}

// TestSeededGuardedHTTPWorkflow_ApproveFiresRealHTTPCall proves the real
// seed's approve path genuinely calls out over HTTP -- pointed at a
// local httptest.Server (no external network, deterministic) instead of
// the real httpbin.org the seed references in production, same
// "test against something real, minus the network dependency" bar
// integrationexec_test.go's own httptest-backed tests already set.
func TestSeededGuardedHTTPWorkflow_ApproveFiresRealHTTPCall(t *testing.T) {
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
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	orig := swapHTTPRequestLookup(t, func(id string) (composition.ResolvedHTTPRequest, error) {
		if id != httprequest.ExampleEnvironmentID {
			t.Errorf("lookupHTTPRequestFn called with id %q, want the seed's real requestId %q", id, httprequest.ExampleEnvironmentID)
		}
		return composition.ResolvedHTTPRequest{BaseURL: srv.URL, AuthType: httprequest.AuthNone}, nil
	})
	defer orig()

	wfID := findBuiltInWorkflowID(t, comp, "Post an update to the client portal")

	summary, err := exec.RunWorkflow(wfID, RunKindTest, nil)
	if err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}
	pending := waitFor(t, "pending approval", 10*time.Second, func() (*PendingApproval, bool) {
		s, err := exec.summaryFor(summary.RunID)
		if err != nil || s.Pending == nil {
			return nil, false
		}
		return s.Pending, true
	})

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
	if !strings.Contains(final.Output, `"ok":true`) {
		t.Fatalf("final.Output = %q, want the real HTTP response body", final.Output)
	}
	if calls := atomic.LoadInt32(&hits); calls != 1 {
		t.Errorf("test server received %d requests, want exactly 1 (the approved step's real call)", calls)
	}
}

// swapHTTPRequestLookup installs fn as composition's HTTP-request lookup
// seam and returns a restore function -- composition.SetHTTPRequestLookup
// is a package-level var with no test-scoped accessor of its own
// (unlike this package's other seams), so this file owns the swap/
// restore discipline rather than reaching into composition's internals.
func swapHTTPRequestLookup(t *testing.T, fn func(id string) (composition.ResolvedHTTPRequest, error)) func() {
	t.Helper()
	// Wraps fn to match SetHTTPRequestLookup's real signature (goal 0203
	// S3 added a composition.SecretAccessRun param) -- every existing
	// test call site stays a plain func(id string), unchanged.
	composition.SetHTTPRequestLookup(func(id string, _ composition.SecretAccessRun) (composition.ResolvedHTTPRequest, error) { return fn(id) })
	return func() {
		// Restores integration.go's own "nothing registered" default
		// (fails loudly rather than silently no-op'ing) -- this package
		// never constructs a ConfigureService (the real production
		// wirer), so there's no other "original" value to save/restore.
		composition.SetHTTPRequestLookup(func(requestID string, _ composition.SecretAccessRun) (composition.ResolvedHTTPRequest, error) {
			return composition.ResolvedHTTPRequest{}, fmt.Errorf("no request lookup registered (yet) for id %q", requestID)
		})
	}
}
