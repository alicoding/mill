package executionsvc

import (
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// A run parked on an approval when the app relaunches: DBOS recovers it
// only when the row's application_version equals the new context's, so
// everything here turns on WorkflowCodeVersion. Same database file,
// two ExecutionServices in sequence -- the real relaunch, not a
// simulation of one.

// newVersionedHarness launches a service against dbPath under an
// explicit workflow-code version and returns it with a guarded
// workflow's ID. A second call on the same dbPath is a relaunch: the
// composition store is fresh (a run's graph travels in its own DBOS
// input, so recovery never needs the definition back), and
// NewExecutionServiceWithVersion runs ReconcileInterrupted as part of
// construction.
func newVersionedHarness(t *testing.T, dbPath, version string) (*ExecutionService, string) {
	t.Helper()
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	guard := guardrailsvc.NewGuardrailService(store, comp)
	exec, err := NewExecutionServiceWithVersion("sqlite:"+dbPath, version, comp, guard)
	if err != nil {
		t.Fatalf("NewExecutionServiceWithVersion(%s): %v", version, err)
	}
	wf, err := comp.CreateWorkflow("Guarded relaunch workflow", "", []composition.Node{
		{ID: "t1", NodeTypeID: "trigger-manual", Position: composition.Position{X: 0, Y: 0}},
		{ID: "n1", NodeTypeID: "test-external-echo", Position: composition.Position{X: 0, Y: 120}},
	}, []composition.Edge{{ID: "e1", Source: "t1", Target: "n1"}})
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}
	return exec, wf.ID
}

// startParkedRun starts a run and waits until it has advertised its
// pending approval, i.e. it is genuinely blocked on Recv.
func startParkedRun(t *testing.T, exec *ExecutionService, wfID string) string {
	t.Helper()
	summary, err := exec.RunWorkflow(wfID, RunKindTest, nil)
	if err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}
	waitFor(t, "pending approval", 10*time.Second, func() (bool, bool) {
		s, err := exec.summaryFor(summary.RunID)
		if err != nil || s.Pending == nil {
			return false, false
		}
		return true, true
	})
	return summary.RunID
}

// Relaunching under a different workflow-code version strands the
// parked run permanently -- DBOS will never re-enqueue it -- so startup
// settles it instead of leaving a Resume button that answers nothing.
func TestReconcileInterrupted_NewVersion_ParkedRunReadsInterrupted(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "exec.db")
	execA, wfID := newVersionedHarness(t, dbPath, "A")
	runID := startParkedRun(t, execA, wfID)
	if err := execA.Shutdown(2 * time.Second); err != nil {
		t.Fatalf("Shutdown: %v", err)
	}

	execB, _ := newVersionedHarness(t, dbPath, "B")
	t.Cleanup(func() { _ = execB.Shutdown(2 * time.Second) })
	// Idempotent: construction already reconciled, and a second pass
	// must not find (or re-cancel) anything.
	if err := execB.ReconcileInterrupted(); err != nil {
		t.Fatalf("ReconcileInterrupted: %v", err)
	}

	s, err := execB.summaryFor(runID)
	if err != nil {
		t.Fatalf("summaryFor: %v", err)
	}
	if s.Status != "CANCELLED" {
		t.Errorf("status = %q, want CANCELLED", s.Status)
	}
	if !s.Interrupted {
		t.Error("Interrupted = false, want true")
	}
	if s.Pending != nil {
		t.Errorf("Pending = %+v, want nil -- nothing is left to approve", s.Pending)
	}
	if s.Resolution != ResolutionInterrupted {
		t.Errorf("Resolution = %q, want %q", s.Resolution, ResolutionInterrupted)
	}
}

// The other half of the same mechanism: relaunching under the SAME
// workflow-code version is what an ordinary restart looks like -- DBOS
// recovers the run, it parks again, and the approval still works. This
// is what pinning the version buys.
func TestReconcileInterrupted_SameVersion_ParkedRunRecoversAndResolves(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "exec.db")
	execA, wfID := newVersionedHarness(t, dbPath, "A")
	runID := startParkedRun(t, execA, wfID)
	if err := execA.Shutdown(2 * time.Second); err != nil {
		t.Fatalf("Shutdown: %v", err)
	}

	execB, _ := newVersionedHarness(t, dbPath, "A")
	t.Cleanup(func() { _ = execB.Shutdown(2 * time.Second) })

	// The durable pending event outlives the process, so summaryFor
	// reports Pending the instant the new service starts -- that is the
	// symptom, not the recovery. The live-park registry is the only
	// honest signal that something is listening again.
	waitFor(t, "the recovered run to park again", 30*time.Second, func() (bool, bool) {
		s, err := execB.summaryFor(runID)
		if err != nil || s.Pending == nil || s.Interrupted {
			return false, false
		}
		_, listening := execB.parkedRuns.Load(runID)
		return listening, listening
	})
	if err := execB.ResolveApproval(runID, "n1", true, nil, false); err != nil {
		t.Fatalf("ResolveApproval: %v", err)
	}
	final := waitFor(t, "the resumed run to finish", 30*time.Second, func() (RunSummary, bool) {
		s, err := execB.summaryFor(runID)
		if err != nil || s.Status == "PENDING" || s.Status == "ENQUEUED" || s.Status == "RUNNING" {
			return RunSummary{}, false
		}
		return s, true
	})
	if final.Status != "SUCCESS" {
		t.Fatalf("status = %q (error %q), want SUCCESS", final.Status, final.Error)
	}
	if final.Resolution != "approved" {
		t.Errorf("Resolution = %q, want approved", final.Resolution)
	}
}

// Answering a run nothing in this process is parked on: a DBOS Send
// would be accepted by the database and read by nobody, so the two
// buttons answer honestly instead of appearing to do nothing.
func TestResolveApproval_NotListening_AnswersInsteadOfSilence(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "exec.db")
	execA, wfID := newVersionedHarness(t, dbPath, "A")
	approveRun := startParkedRun(t, execA, wfID)
	denyRun := startParkedRun(t, execA, wfID)
	if err := execA.Shutdown(2 * time.Second); err != nil {
		t.Fatalf("Shutdown: %v", err)
	}

	execB, _ := newVersionedHarness(t, dbPath, "B")
	t.Cleanup(func() { _ = execB.Shutdown(2 * time.Second) })

	err := execB.ResolveApproval(approveRun, "n1", true, nil, false)
	if err == nil || !strings.Contains(err.Error(), "run-not-waiting") {
		t.Fatalf("approve on an unlistened run: err = %v, want one containing run-not-waiting", err)
	}

	if err := execB.ResolveApproval(denyRun, "n1", false, nil, false); err != nil {
		t.Fatalf("deny on an unlistened run: %v", err)
	}
	s, err := execB.summaryFor(denyRun)
	if err != nil {
		t.Fatalf("summaryFor: %v", err)
	}
	if s.Status != "CANCELLED" {
		t.Errorf("status after deny = %q, want CANCELLED", s.Status)
	}
}

// A run parked in THIS process is answered by the ordinary Send path --
// the registry never gets in the way of the case it was added for.
func TestResolveApproval_Listening_UsesTheSendPath(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "exec.db")
	exec, wfID := newVersionedHarness(t, dbPath, "A")
	t.Cleanup(func() { _ = exec.Shutdown(2 * time.Second) })
	runID := startParkedRun(t, exec, wfID)

	if _, listening := exec.parkedRuns.Load(runID); !listening {
		t.Fatal("a run blocked on Recv must be in the live-park registry")
	}
	if err := exec.ResolveApproval(runID, "n1", true, nil, false); err != nil {
		t.Fatalf("ResolveApproval: %v", err)
	}
	final := waitFor(t, "the resumed run to finish", 30*time.Second, func() (RunSummary, bool) {
		s, err := exec.summaryFor(runID)
		if err != nil || s.Status == "PENDING" || s.Status == "ENQUEUED" || s.Status == "RUNNING" {
			return RunSummary{}, false
		}
		return s, true
	})
	if final.Status != "SUCCESS" {
		t.Fatalf("status = %q (error %q), want SUCCESS", final.Status, final.Error)
	}
	if _, listening := exec.parkedRuns.Load(runID); listening {
		t.Error("the registry entry must be cleared once Recv returns")
	}
}
