package executionsvc

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/adapters/execution"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/guardrail"
	"github.com/alicoding/mill/internal/domain/httprequest"
	"github.com/alicoding/mill/internal/domain/secret"
	"github.com/alicoding/mill/internal/domain/usererror"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// A test-only pure step reading a "secret": its exec fails with the
// vault-locked sentinel while testVaultLocked is set, exactly the error
// every real resolution seam returns (secretvault.ErrLocked wraps
// secret.ErrVaultLocked) -- so the executor's park/resume is provable
// against a real DBOS runtime with no vault file. ClassNone, so no
// approval ask precedes the wait.
const testSecretReadNodeTypeID = "test-secret-read"

var testVaultLocked atomic.Bool

func init() {
	composition.RegisterNodeType(composition.NodeType{
		ID: testSecretReadNodeTypeID, Kind: composition.KindProcess,
		Label:  "Test: reads a secret",
		Effect: guardrail.ClassNone,
	}, func(_ composition.Node, ctx composition.ExecContext) (composition.ExecContext, error) {
		if testVaultLocked.Load() {
			return ctx, fmt.Errorf("test: resolving vault secret: %w", secret.ErrVaultLocked)
		}
		ctx.Payload += "[secret-read]"
		return ctx, nil
	})
	composition.RegisterNodeType(composition.NodeType{
		ID: "test-first-step", Kind: composition.KindProcess,
		Label:  "Test: first step",
		Effect: guardrail.ClassNone,
	}, func(_ composition.Node, ctx composition.ExecContext) (composition.ExecContext, error) {
		ctx.Payload += "[first]"
		return ctx, nil
	})
}

// newVaultWaitHarness builds a trigger -> pure step -> secret-read
// workflow on a fresh runtime whose "is the vault locked" answer is
// testVaultLocked, and makes the secret step report a secret label so
// RunWorkflow's own pre-scan sees it.
func newVaultWaitHarness(t *testing.T) (*ExecutionService, string) {
	t.Helper()
	testVaultLocked.Store(false)
	t.Cleanup(func() { testVaultLocked.Store(false) })
	swapSecretLabelsLookup(t, func(nodeTypeID string, _ map[string]string) []string {
		if nodeTypeID == testSecretReadNodeTypeID {
			return []string{"Example API key"}
		}
		return nil
	})
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	guard := guardrailsvc.NewGuardrailService(store, comp)
	dbPath := filepath.Join(t.TempDir(), "exec.db")
	exec, err := NewExecutionService("sqlite:"+dbPath, comp, guard)
	if err != nil {
		t.Fatalf("NewExecutionService: %v", err)
	}
	t.Cleanup(func() { _ = exec.Shutdown(2 * time.Second) })
	exec.SetVaultLockedLookup(testVaultLocked.Load)

	wf, err := comp.CreateWorkflow("Reads a secret", "", []composition.Node{
		{ID: "t1", NodeTypeID: "trigger-manual", Position: composition.Position{X: 0, Y: 0}},
		{ID: "first", NodeTypeID: "test-first-step", Position: composition.Position{X: 0, Y: 100}},
		{ID: "read", NodeTypeID: testSecretReadNodeTypeID, Position: composition.Position{X: 0, Y: 200}},
	}, []composition.Edge{{ID: "e1", Source: "t1", Target: "first"}, {ID: "e2", Source: "first", Target: "read"}})
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}
	return exec, wf.ID
}

func awaitVaultPark(t *testing.T, exec *ExecutionService, runID string) *PendingApproval {
	t.Helper()
	return waitFor(t, "vault park", 10*time.Second, func() (*PendingApproval, bool) {
		s, err := exec.summaryFor(runID)
		if err != nil || s.Pending == nil || s.Pending.Reason != ParkReasonVaultLocked {
			return nil, false
		}
		return s.Pending, true
	})
}

func awaitStatus(t *testing.T, exec *ExecutionService, runID, status string) RunSummary {
	t.Helper()
	return waitFor(t, "run status "+status, 15*time.Second, func() (RunSummary, bool) {
		s, err := exec.summaryFor(runID)
		if err != nil || s.Status != status {
			return RunSummary{}, false
		}
		return s, true
	})
}

func stepByID(t *testing.T, detail RunDetail, id string) RunStep {
	t.Helper()
	for _, s := range detail.Steps {
		if s.NodeID == id {
			return s
		}
	}
	t.Fatalf("run %s has no step %s", detail.RunID, id)
	return RunStep{}
}

// A run reading a secret while the vault is locked parks at THAT step
// with reason vault-locked -- the earlier step's output kept, the Run
// call returning at once -- and an unlock resumes it to completion with
// the wait recorded on the step and "resumed" as the run's resolution.
func TestVaultWait_LockedReadParksAtTheStep_UnlockResumes(t *testing.T) {
	exec, wfID := newVaultWaitHarness(t)
	testVaultLocked.Store(true)

	started := time.Now()
	summary, err := exec.RunWorkflow(wfID, RunKindTest, nil)
	if err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}
	if time.Since(started) > 5*time.Second || summary.Status == "SUCCESS" {
		t.Fatalf("RunWorkflow blocked on the locked vault (took %s, status %s)", time.Since(started), summary.Status)
	}

	pending := awaitVaultPark(t, exec, summary.RunID)
	if pending.NodeID != "read" || pending.NodeTypeID != testSecretReadNodeTypeID {
		t.Fatalf("pending = %+v, want the secret-reading step", pending)
	}
	if pending.NodeTypeLabel != "Test: reads a secret" {
		t.Fatalf("pending.NodeTypeLabel = %q", pending.NodeTypeLabel)
	}
	detail, err := exec.GetRun(summary.RunID)
	if err != nil {
		t.Fatalf("GetRun: %v", err)
	}
	if first := stepByID(t, detail, "first"); first.Status != "succeeded" || first.Output != "[first]" {
		t.Fatalf("first step = %+v, want its output kept across the wait", first)
	}
	read := stepByID(t, detail, "read")
	if read.Status != "awaiting-approval" || len(read.Waits) != 1 || read.Waits[0].Reason != ParkReasonVaultLocked || !read.Waits[0].ResumedAt.IsZero() {
		t.Fatalf("parked step = %+v, want awaiting with one open vault wait", read)
	}

	testVaultLocked.Store(false)
	exec.ResumeVaultWaits()

	done := awaitStatus(t, exec, summary.RunID, "SUCCESS")
	if done.Output != "[first][secret-read]" {
		t.Fatalf("output = %q", done.Output)
	}
	if done.Resolution != ResolutionResumed {
		t.Fatalf("resolution = %q, want %q", done.Resolution, ResolutionResumed)
	}
	detail, err = exec.GetRun(summary.RunID)
	if err != nil {
		t.Fatalf("GetRun: %v", err)
	}
	read = stepByID(t, detail, "read")
	if read.Status != "succeeded" || len(read.Waits) != 1 || read.Waits[0].ResumedAt.IsZero() || read.Waits[0].ResumedAt.Before(read.Waits[0].ParkedAt) {
		t.Fatalf("resumed step = %+v, want one closed wait with parkedAt <= resumedAt", read)
	}
	evidence, err := exec.runEvidenceFor(summary.RunID)
	if err != nil {
		t.Fatalf("runEvidenceFor: %v", err)
	}
	var receiptWaits int
	for _, s := range evidence.Steps {
		for _, w := range s.Waits {
			if s.StepID == "read" && w.Parked == ParkReasonVaultLocked && !w.ParkedAt.IsZero() && !w.ResumedAt.IsZero() {
				receiptWaits++
			}
		}
	}
	if receiptWaits != 1 {
		t.Fatalf("receipt records %d vault waits on the step, want 1", receiptWaits)
	}
}

// Two runs waiting on the vault resume oldest first, and both finish.
func TestVaultWait_UnlockResumesOldestFirst(t *testing.T) {
	exec, wfID := newVaultWaitHarness(t)
	testVaultLocked.Store(true)

	first, err := exec.RunWorkflow(wfID, RunKindTest, nil)
	if err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}
	awaitVaultPark(t, exec, first.RunID)
	time.Sleep(20 * time.Millisecond) // distinct ParkedAt for the ordering under test
	second, err := exec.RunWorkflow(wfID, RunKindTest, nil)
	if err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}
	awaitVaultPark(t, exec, second.RunID)

	if got := exec.vaultWaitsOldestFirst(); len(got) != 2 || got[0].runID != first.RunID || got[1].runID != second.RunID {
		t.Fatalf("resume order = %v, want [%s %s]", got, first.RunID, second.RunID)
	}

	testVaultLocked.Store(false)
	exec.ResumeVaultWaits()
	awaitStatus(t, exec, first.RunID, "SUCCESS")
	awaitStatus(t, exec, second.RunID, "SUCCESS")
	if _, still := exec.vaultWaits.Load(first.RunID); still {
		t.Fatal("a resumed run is still registered as waiting on the vault")
	}
}

// The vault locking again before a resumed step reads parks the run
// afresh: a second wait, its own card, the first recorded as resumed.
func TestVaultWait_LockedAgainMidResume_ParksAgain(t *testing.T) {
	exec, wfID := newVaultWaitHarness(t)
	testVaultLocked.Store(true)

	summary, err := exec.RunWorkflow(wfID, RunKindTest, nil)
	if err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}
	awaitVaultPark(t, exec, summary.RunID)

	// Still locked when the resume reaches the step.
	exec.ResumeVaultWaits()
	waitFor(t, "second vault park", 10*time.Second, func() (bool, bool) {
		d, err := exec.GetRun(summary.RunID)
		if err != nil {
			return false, false
		}
		read := stepByID(t, d, "read")
		ok := len(read.Waits) == 2 && !read.Waits[0].ResumedAt.IsZero() && read.Waits[1].ResumedAt.IsZero()
		return ok, ok
	})
	if _, listening := exec.parkedRuns.Load(summary.RunID); !listening {
		t.Fatal("the re-parked run is absent from the live-park registry")
	}

	testVaultLocked.Store(false)
	exec.ResumeVaultWaits()
	done := awaitStatus(t, exec, summary.RunID, "SUCCESS")
	if done.Resolution != ResolutionResumed {
		t.Fatalf("resolution = %q", done.Resolution)
	}
}

// Regression (the same class executionservice_guardrail_test.go pins
// for approvals): the live-park registry entry exists by the time the
// vault park is observable, so a resume arriving the instant the card
// appears is never refused as "run-recovering".
func TestVaultWait_PendingVisible_ResumesWithoutRecoveringRefusal(t *testing.T) {
	exec, wfID := newVaultWaitHarness(t)
	testVaultLocked.Store(true)

	summary, err := exec.RunWorkflow(wfID, RunKindTest, nil)
	if err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}
	pending, err := execution.GetEvent[PendingApproval](exec.ctx, summary.RunID, guardrailPendingEventKey, 10*time.Second)
	if err != nil {
		t.Fatalf("await pending event: %v", err)
	}
	if pending.Reason != ParkReasonVaultLocked {
		t.Fatalf("pending = %+v, want a vault wait", pending)
	}
	if _, listening := exec.parkedRuns.Load(summary.RunID); !listening {
		t.Fatal("vault wait is observable but the run is absent from the live-park registry")
	}
	if _, waiting := exec.vaultWaits.Load(summary.RunID); !waiting {
		t.Fatal("vault wait is observable but the run is absent from the vault-wait registry")
	}
	testVaultLocked.Store(false)
	if err := exec.ResolveApproval(summary.RunID, pending.NodeID, true, nil, false); err != nil {
		if code, ok := usererror.Of(err); ok && code.Code == "run-recovering" {
			t.Fatalf("resume on a visibly parked run was refused as recovering: %v", err)
		}
		t.Fatalf("ResolveApproval: %v", err)
	}
	awaitStatus(t, exec, summary.RunID, "SUCCESS")
}

// Stop run on a vault wait is the ordinary stop: the run ends cancelled
// and nothing is left waiting.
func TestVaultWait_StopRun_CancelsAndClearsTheWait(t *testing.T) {
	exec, wfID := newVaultWaitHarness(t)
	testVaultLocked.Store(true)

	summary, err := exec.RunWorkflow(wfID, RunKindTest, nil)
	if err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}
	awaitVaultPark(t, exec, summary.RunID)
	if err := exec.CancelRun(summary.RunID); err != nil {
		t.Fatalf("CancelRun: %v", err)
	}
	done := awaitStatus(t, exec, summary.RunID, "CANCELLED")
	if done.Pending != nil {
		t.Fatalf("a stopped run still advertises a park: %+v", done.Pending)
	}
	// The next unlock must not resume it: a stopped run is not live.
	if exec.runIsLive(summary.RunID) {
		t.Fatal("a stopped run still counts as live for the next unlock")
	}
	testVaultLocked.Store(false)
	exec.ResumeVaultWaits()
	if s, err := exec.summaryFor(summary.RunID); err != nil || s.Status != "CANCELLED" {
		t.Fatalf("after an unlock the stopped run reads %+v (%v), want CANCELLED", s, err)
	}
}

// The seeded proof: "Example: Scheduled read of a secret" is a disabled
// schedule calling the seeded API-key request; run by hand with the
// vault locked it asks (an external step), then waits for the vault at
// its step, then completes against the request once unlocked.
func TestSeededScheduledSecretRead_WaitsForVaultThenCompletes(t *testing.T) {
	exec, comp := newTestExecutionService(t)
	wfID := findBuiltInWorkflowID(t, comp, "Example: Scheduled read of a secret")
	var wf composition.Workflow
	for _, w := range comp.Workflows() {
		if w.ID == wfID {
			wf = w
		}
	}
	if !wf.Disabled || wf.ID != composition.ExampleScheduledSecretReadWorkflowID {
		t.Fatalf("seed = %+v, want the disabled scheduled example", wf)
	}
	var step composition.Node
	for _, n := range wf.Nodes {
		if n.ID == composition.ExampleScheduledSecretReadStepID {
			step = n
		}
	}
	if step.NodeTypeID != "integration-http" || step.Config["requestId"] != httprequest.ExampleAPIKeyID {
		t.Fatalf("seeded step = %+v, want integration-http on the API-key example", step)
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"headers":{"X-Api-Key":"demo"}}`))
	}))
	t.Cleanup(srv.Close)
	var locked atomic.Bool
	locked.Store(true)
	restore := swapHTTPRequestLookup(t, func(id string) (composition.ResolvedHTTPRequest, error) {
		if locked.Load() {
			return composition.ResolvedHTTPRequest{}, fmt.Errorf("request %q: resolving secret: %w", id, secret.ErrVaultLocked)
		}
		return composition.ResolvedHTTPRequest{BaseURL: srv.URL, Method: "GET", AuthType: httprequest.AuthNone}, nil
	})
	t.Cleanup(restore)

	summary, err := exec.RunWorkflow(wfID, RunKindTest, nil)
	if err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}
	ask := waitFor(t, "approval ask", 10*time.Second, func() (*PendingApproval, bool) {
		s, err := exec.summaryFor(summary.RunID)
		if err != nil || s.Pending == nil || s.Pending.Reason != "" {
			return nil, false
		}
		return s.Pending, true
	})
	if err := exec.ResolveApproval(summary.RunID, ask.NodeID, true, nil, false); err != nil {
		t.Fatalf("approve: %v", err)
	}
	pending := awaitVaultPark(t, exec, summary.RunID)
	if pending.NodeID != composition.ExampleScheduledSecretReadStepID {
		t.Fatalf("vault park at %q, want the seeded step", pending.NodeID)
	}

	locked.Store(false)
	exec.ResumeVaultWaits()
	done := awaitStatus(t, exec, summary.RunID, "SUCCESS")
	if done.Output != `{"headers":{"X-Api-Key":"demo"}}` {
		t.Fatalf("output = %q", done.Output)
	}
}
