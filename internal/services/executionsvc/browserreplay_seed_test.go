package executionsvc

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/browserbridge"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/bridgesvc"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// The seeded "Replay a browser flow" example through the real stack:
// the guardrail parks it (driving a live site is an external effect),
// an approval releases it, the recording reaches the browser seam with
// this run's own Attributes overlaid, and the extracted text comes back
// in the step's output.
//
// The browser half is a stub speaking composition's own seam rather
// than a paired browser -- what this proves is Mill's half, end to end
// through DBOS; the wire protocol has its own tests in bridgesvc, and
// the whole channel has browser-replay.spec.ts.

// The seeded example's default page address is assembled from two
// constants a domain package cannot import. Pin it here so a change to
// either one fails the build instead of leaving a seed pointing at a
// port nothing listens on.
func TestSeededBrowserReplay_DefaultPageURLMatchesTheBridge(t *testing.T) {
	want := "http://" + bridgesvc.AddrDefault + bridgesvc.TestPagePath
	if composition.ExampleBrowserReplayPageURL != want {
		t.Errorf("the seeded example's page url is %q, want %q", composition.ExampleBrowserReplayPageURL, want)
	}
}

// swapBrowserReplayer installs a stub browser for one test and restores
// the fail-loud default afterwards, so nothing leaks into the rest of
// this package.
func swapBrowserReplayer(t *testing.T, fn func(flow browserbridge.UserFlow, timeout time.Duration) (composition.BrowserReplayOutcome, error)) {
	t.Helper()
	composition.SetBrowserReplayer(fn)
	t.Cleanup(func() {
		composition.SetBrowserReplayer(func(_ browserbridge.UserFlow, _ time.Duration) (composition.BrowserReplayOutcome, error) {
			return composition.BrowserReplayOutcome{}, browserbridge.ErrNoBrowser()
		})
	})
}

func newBrowserReplayHarness(t *testing.T) (*ExecutionService, string) {
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
	return exec, findBuiltInWorkflowID(t, comp, "Example: Replay a browser flow")
}

// approveTheReplay parks-then-approves the run's browser step and
// returns the run's final summary.
func approveTheReplay(t *testing.T, exec *ExecutionService, runID string) RunSummary {
	t.Helper()
	pending := waitFor(t, "pending approval", 15*time.Second, func() (*PendingApproval, bool) {
		s, err := exec.summaryFor(runID)
		if err != nil || s.Pending == nil {
			return nil, false
		}
		return s.Pending, true
	})
	if pending.NodeTypeID != "process-browser-replay" {
		t.Fatalf("pending.NodeTypeID = %q, want process-browser-replay", pending.NodeTypeID)
	}
	if err := exec.ResolveApproval(runID, pending.NodeID, true, nil, false); err != nil {
		t.Fatalf("ResolveApproval(approve): %v", err)
	}
	return waitFor(t, "run to finish", 15*time.Second, func() (RunSummary, bool) {
		s, err := exec.summaryFor(runID)
		if err != nil || (s.Status != "SUCCESS" && s.Status != "ERROR" && s.Status != "MAX_RECOVERY_ATTEMPTS_EXCEEDED") {
			return RunSummary{}, false
		}
		return s, true
	})
}

func TestSeededBrowserReplay_RunsTheRecordingAndExtractsTheEcho(t *testing.T) {
	exec, wfID := newBrowserReplayHarness(t)

	var sent browserbridge.UserFlow
	var budget time.Duration
	swapBrowserReplayer(t, func(flow browserbridge.UserFlow, timeout time.Duration) (composition.BrowserReplayOutcome, error) {
		sent, budget = flow, timeout
		// The page echoes back exactly what the change step typed --
		// the same thing the real test page does on the button press.
		return composition.BrowserReplayOutcome{Steps: []composition.BrowserReplayStep{
			{Index: 0, Status: browserbridge.StatusOK},
			{Index: 1, Status: browserbridge.StatusOK, Extracted: flow.Steps[1].Value},
			{Index: 2, Status: browserbridge.StatusOK},
			{Index: 3, Status: browserbridge.StatusOK, Extracted: flow.Steps[1].Value},
		}}, nil
	})

	summary, err := exec.RunWorkflow(wfID, RunKindTest, map[string]string{
		"pageUrl": "http://127.0.0.1:9401/__mill/bridge/test-page",
		"text":    "typed by this run",
	})
	if err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}
	final := approveTheReplay(t, exec, summary.RunID)
	if final.Status != "SUCCESS" {
		t.Fatalf("run status = %s, error %q", final.Status, final.Error)
	}

	if sent.Steps[0].URL != "http://127.0.0.1:9401/__mill/bridge/test-page" {
		t.Errorf("the browser was sent url %q, want this run's bound address", sent.Steps[0].URL)
	}
	if sent.Steps[1].Value != "typed by this run" {
		t.Errorf("the browser was sent value %q, want this run's bound text", sent.Steps[1].Value)
	}
	if budget != 60*time.Second {
		t.Errorf("the run's budget was %v, want the seed's 60s", budget)
	}

	var out struct {
		Steps     []struct{ Index int } `json:"steps"`
		Extracted map[string]string     `json:"extracted"`
		Downloads []any                 `json:"downloads"`
	}
	if err := json.Unmarshal([]byte(finalStepOutput(t, exec, summary.RunID)), &out); err != nil {
		t.Fatalf("the step's output is not readable JSON: %v", err)
	}
	if out.Extracted[composition.ExampleBrowserReplayOutput] != "typed by this run" {
		t.Errorf("extracted = %v, want the echoed text under %q", out.Extracted, composition.ExampleBrowserReplayOutput)
	}
	if len(out.Steps) != 4 {
		t.Errorf("the output reports %d steps, want 4", len(out.Steps))
	}
}

// Nothing paired is the one failure a reader can fix themselves, and
// the run must say so rather than failing with a generic sentence.
func TestSeededBrowserReplay_WithNoBrowserFailsWithThePairFirstSentence(t *testing.T) {
	exec, wfID := newBrowserReplayHarness(t)
	swapBrowserReplayer(t, func(browserbridge.UserFlow, time.Duration) (composition.BrowserReplayOutcome, error) {
		return composition.BrowserReplayOutcome{}, browserbridge.ErrNoBrowser()
	})

	summary, err := exec.RunWorkflow(wfID, RunKindTest, nil)
	if err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}
	final := approveTheReplay(t, exec, summary.RunID)
	if final.Status == "SUCCESS" {
		t.Fatal("the run succeeded with no browser connected")
	}
	if !strings.Contains(final.Error, "No browser is connected. Pair the Mill extension first.") {
		t.Errorf("final.Error = %q, want the pair-first sentence", final.Error)
	}
}

// finalStepOutput reads the browser step's own recorded output off the
// finished run.
func finalStepOutput(t *testing.T, exec *ExecutionService, runID string) string {
	t.Helper()
	run, err := exec.GetRun(runID)
	if err != nil {
		t.Fatalf("GetRun: %v", err)
	}
	for _, step := range run.Steps {
		if step.NodeTypeID == "process-browser-replay" {
			return step.Output
		}
	}
	t.Fatal("the finished run has no browser-replay step")
	return ""
}
