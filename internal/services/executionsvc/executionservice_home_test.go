package executionsvc

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/guardrail"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// classifyStatus is a pure function -- table-driven unit test per
// .claude/rules/testing.md's own layering ("pure logic across its input
// range" belongs at the unit-test layer, not a seeded end-to-end proof).
func TestClassifyStatus(t *testing.T) {
	cases := []struct {
		status      string
		wantSuccess bool
		wantFailure bool
	}{
		{"SUCCESS", true, false},
		{"ERROR", false, true},
		{"MAX_RECOVERY_ATTEMPTS_EXCEEDED", false, true},
		{"CANCELLED", false, false},
		{"PENDING", false, false},
		{"ENQUEUED", false, false},
		{"DELAYED", false, false},
		{"", false, false},
	}
	for _, c := range cases {
		success, failure := classifyStatus(c.status)
		if success != c.wantSuccess || failure != c.wantFailure {
			t.Errorf("classifyStatus(%q) = (%v, %v), want (%v, %v)", c.status, success, failure, c.wantSuccess, c.wantFailure)
		}
	}
}

// errorRateFor/dailySeriesFor/mostUsedFor/ambientFor are pure functions
// over []RunSummary -- exercised directly here with hand-built fixtures
// rather than a real DBOS run per case, per the same unit-test-layer
// reasoning as TestClassifyStatus above.

func TestErrorRateFor_ExcludesCancelledAndParkedFromBothCounts(t *testing.T) {
	runs := []RunSummary{
		{Status: "SUCCESS"},
		{Status: "SUCCESS"},
		{Status: "ERROR"},
		{Status: "CANCELLED"}, // excluded from both, per goal 0014
		{Status: "PENDING"},   // parked/waiting, excluded until resolved
		{Status: "ENQUEUED"},  // same
		{Status: "DELAYED"},   // same
	}
	got := errorRateFor(runs)
	if got.SuccessCount != 2 || got.ErrorCount != 1 || got.TotalTerminal != 3 {
		t.Fatalf("errorRateFor = %+v, want SuccessCount=2 ErrorCount=1 TotalTerminal=3", got)
	}
	if got.RatePercent == nil {
		t.Fatal("RatePercent is nil, want a real value (TotalTerminal > 0)")
	}
	want := 100.0 / 3.0
	if diff := *got.RatePercent - want; diff > 0.001 || diff < -0.001 {
		t.Errorf("RatePercent = %v, want ~%v", *got.RatePercent, want)
	}
}

func TestErrorRateFor_NoTerminalRuns_RatePercentIsNilNotZero(t *testing.T) {
	got := errorRateFor([]RunSummary{{Status: "PENDING"}, {Status: "CANCELLED"}})
	if got.TotalTerminal != 0 {
		t.Fatalf("TotalTerminal = %d, want 0", got.TotalTerminal)
	}
	// Never a bare percentage without volume (goal 0014) -- nil, not a
	// misleading 0%, when there's nothing to divide by.
	if got.RatePercent != nil {
		t.Errorf("RatePercent = %v, want nil when TotalTerminal is 0", *got.RatePercent)
	}
}

func TestDailySeriesFor_BucketsByLocalDayAndSuppressesRateBelowMinCount(t *testing.T) {
	day1 := time.Date(2026, 8, 1, 9, 0, 0, 0, time.Local)
	day2 := time.Date(2026, 8, 2, 9, 0, 0, 0, time.Local)
	runs := []RunSummary{
		// day1: 2 terminal runs -- below minBucketRunsForRate (3), rate suppressed
		{StartedAt: day1, Status: "SUCCESS"},
		{StartedAt: day1, Status: "ERROR"},
		// day2: 3 terminal runs -- at the threshold, rate shown
		{StartedAt: day2, Status: "SUCCESS"},
		{StartedAt: day2, Status: "SUCCESS"},
		{StartedAt: day2, Status: "ERROR"},
		// non-terminal on day2 -- must not inflate Total
		{StartedAt: day2, Status: "CANCELLED"},
	}
	got := dailySeriesFor(runs)
	if len(got) != 2 {
		t.Fatalf("dailySeriesFor returned %d buckets, want 2", len(got))
	}
	if got[0].Date != "2026-08-01" || got[0].Total != 2 || got[0].RatePercent != nil {
		t.Errorf("bucket[0] = %+v, want Date=2026-08-01 Total=2 RatePercent=nil (below min sample)", got[0])
	}
	if got[1].Date != "2026-08-02" || got[1].Total != 3 || got[1].RatePercent == nil {
		t.Errorf("bucket[1] = %+v, want Date=2026-08-02 Total=3 RatePercent=non-nil", got[1])
	}
}

func TestMostUsedFor_SortsByRunCountDescendingThenLabel(t *testing.T) {
	runs := []RunSummary{
		{WorkflowID: "a", WorkflowLabel: "A"},
		{WorkflowID: "b", WorkflowLabel: "B"},
		{WorkflowID: "b", WorkflowLabel: "B"},
		{WorkflowID: "b", WorkflowLabel: "B"},
		{WorkflowID: "a", WorkflowLabel: "A"},
	}
	got := mostUsedFor(runs)
	if len(got) != 2 || got[0].WorkflowID != "b" || got[0].RunCount != 3 || got[1].WorkflowID != "a" || got[1].RunCount != 2 {
		t.Fatalf("mostUsedFor = %+v, want [{b 3} {a 2}]", got)
	}
}

// runDuration/avgDurationFor are goal 0051 item 1's pure aggregation --
// table-driven per .claude/rules/testing.md's "pure logic across its
// input range" layer.
func TestRunDuration_ExcludesInFlightAndNonPositiveSpans(t *testing.T) {
	start := time.Date(2026, 8, 1, 9, 0, 0, 0, time.UTC)
	cases := []struct {
		name string
		run  RunSummary
		want time.Duration
		ok   bool
	}{
		{"completed", RunSummary{StartedAt: start, CompletedAt: start.Add(30 * time.Second)}, 30 * time.Second, true},
		{"still in flight (zero CompletedAt)", RunSummary{StartedAt: start}, 0, false},
		{"completed in the same instant (real, valid zero duration)", RunSummary{StartedAt: start, CompletedAt: start}, 0, true},
		{"completed before started (clock skew)", RunSummary{StartedAt: start, CompletedAt: start.Add(-time.Second)}, 0, false},
	}
	for _, c := range cases {
		got, ok := runDuration(c.run)
		if ok != c.ok || (ok && got != c.want) {
			t.Errorf("%s: runDuration = (%v, %v), want (%v, %v)", c.name, got, ok, c.want, c.ok)
		}
	}
}

func TestAvgDurationFor_ZeroRuns_SampleSizeZeroAvgNil(t *testing.T) {
	got := avgDurationFor(nil)
	if got.SampleSize != 0 || got.AvgSeconds != nil {
		t.Fatalf("avgDurationFor(nil) = %+v, want SampleSize=0 AvgSeconds=nil", got)
	}
}

func TestAvgDurationFor_OnlyInFlightRuns_SampleSizeZeroAvgNil(t *testing.T) {
	start := time.Date(2026, 8, 1, 9, 0, 0, 0, time.UTC)
	got := avgDurationFor([]RunSummary{{StartedAt: start}, {StartedAt: start}})
	if got.SampleSize != 0 || got.AvgSeconds != nil {
		t.Fatalf("avgDurationFor(all in-flight) = %+v, want SampleSize=0 AvgSeconds=nil -- never fake a duration for a run still running", got)
	}
}

func TestAvgDurationFor_SingleRun_AveragesToItsOwnDuration(t *testing.T) {
	start := time.Date(2026, 8, 1, 9, 0, 0, 0, time.UTC)
	got := avgDurationFor([]RunSummary{{StartedAt: start, CompletedAt: start.Add(10 * time.Second)}})
	if got.SampleSize != 1 || got.AvgSeconds == nil || *got.AvgSeconds != 10 {
		t.Fatalf("avgDurationFor(single 10s run) = %+v, want SampleSize=1 AvgSeconds=10", got)
	}
}

func TestAvgDurationFor_MixedRuns_ExcludesInFlightFromBothSumAndCount(t *testing.T) {
	start := time.Date(2026, 8, 1, 9, 0, 0, 0, time.UTC)
	runs := []RunSummary{
		{StartedAt: start, CompletedAt: start.Add(10 * time.Second)},
		{StartedAt: start, CompletedAt: start.Add(20 * time.Second)},
		{StartedAt: start}, // still in flight -- must not drag the average toward 0
	}
	got := avgDurationFor(runs)
	if got.SampleSize != 2 || got.AvgSeconds == nil || *got.AvgSeconds != 15 {
		t.Fatalf("avgDurationFor(mixed) = %+v, want SampleSize=2 AvgSeconds=15 (in-flight run excluded from both sum and count)", got)
	}
}

// mostUsedFor's own duration/recency columns (goal 0051 items 1/2).
func TestMostUsedFor_PerWorkflowAvgDurationAndLastTriggeredAt(t *testing.T) {
	start := time.Date(2026, 8, 1, 9, 0, 0, 0, time.UTC)
	later := start.Add(time.Hour)
	runs := []RunSummary{
		{WorkflowID: "a", WorkflowLabel: "A", Kind: RunKindTriggered, StartedAt: start, CompletedAt: start.Add(10 * time.Second)},
		{WorkflowID: "a", WorkflowLabel: "A", Kind: RunKindTest, StartedAt: later, CompletedAt: later.Add(20 * time.Second)},
		{WorkflowID: "b", WorkflowLabel: "B", Kind: RunKindTest, StartedAt: start}, // never triggered, still in flight
	}
	got := mostUsedFor(runs)
	byID := map[string]WorkflowUsage{}
	for _, u := range got {
		byID[u.WorkflowID] = u
	}

	a := byID["a"]
	if a.AvgDurationSeconds == nil || *a.AvgDurationSeconds != 15 {
		t.Errorf("workflow a AvgDurationSeconds = %v, want 15 (average of its 10s and 20s runs)", a.AvgDurationSeconds)
	}
	// The test-kind run started LATER but must not count toward
	// LastTriggeredAt -- only ambient (non-test) runs do.
	if a.LastTriggeredAt == nil || !a.LastTriggeredAt.Equal(start) {
		t.Errorf("workflow a LastTriggeredAt = %v, want %v (its one triggered run, the later test run excluded)", a.LastTriggeredAt, start)
	}

	b := byID["b"]
	if b.AvgDurationSeconds != nil {
		t.Errorf("workflow b AvgDurationSeconds = %v, want nil (its only run is still in flight)", b.AvgDurationSeconds)
	}
	if b.LastTriggeredAt != nil {
		t.Errorf("workflow b LastTriggeredAt = %v, want nil (its only run is test-kind, never ambient)", b.LastTriggeredAt)
	}
}

func TestAmbientFor_ComputesTriggeredVsManualRatio(t *testing.T) {
	runs := []RunSummary{
		{Kind: RunKindTriggered}, {Kind: RunKindTriggered}, {Kind: RunKindTriggered},
		{Kind: RunKindTest},
	}
	got := ambientFor(runs)
	if got.TriggeredCount != 3 || got.ManualCount != 1 {
		t.Fatalf("ambientFor = %+v, want TriggeredCount=3 ManualCount=1", got)
	}
	if got.AmbientPercent == nil || *got.AmbientPercent != 75.0 {
		t.Fatalf("AmbientPercent = %v, want 75", got.AmbientPercent)
	}
}

func TestAmbientFor_NoRuns_PercentIsNil(t *testing.T) {
	got := ambientFor(nil)
	if got.AmbientPercent != nil {
		t.Errorf("AmbientPercent = %v, want nil with zero runs", *got.AmbientPercent)
	}
}

// test-home-fail is a test-only ClassNone (no guardrail gate) node type
// that always errors -- deterministically proves a failed triggered run
// credits nothing toward TimeSaved and counts as ErrorCount, without any
// real external dependency. Registered once at init, same pattern
// executionservice_guardrail_test.go's test-external-echo already
// established in this package.
func init() {
	composition.RegisterNodeType(composition.NodeType{
		ID: "test-home-fail", Kind: composition.KindProcess,
		Label:  "Test: always fails",
		Effect: guardrail.ClassNone,
	}, func(_ composition.Node, ctx composition.ExecContext) (composition.ExecContext, error) {
		return ctx, errTestHomeFail
	})
}

var errTestHomeFail = &homeTestError{}

type homeTestError struct{}

func (*homeTestError) Error() string { return "deliberate test failure" }

func newHomeHarness(t *testing.T) (*compositionsvc.CompositionService, *ExecutionService) {
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
	return comp, exec
}

// The integration proof: HomeMetrics against a real DBOS runtime,
// exercising exactly docs/goals/0014's locked semantics end to end --
// only Success + RunKind:triggered runs credit TimeSaved (a failed
// triggered run and a successful test run both credit nothing), and the
// per-workflow minutes-saved lookup (SetMinutesSavedLookup) drives the
// formula.
func TestHomeMetrics_TimeSaved_CreditsOnlySuccessfulTriggeredRuns(t *testing.T) {
	comp, exec := newHomeHarness(t)
	exec.SetMinutesSavedLookup(func(string) int { return 5 })

	okWF, err := comp.CreateWorkflow("Ok workflow", "", []composition.Node{
		{ID: "t1", NodeTypeID: "trigger-manual", Position: composition.Position{X: 0, Y: 0}},
		{ID: "n1", NodeTypeID: "process-inject-text", Position: composition.Position{X: 0, Y: 100},
			Config: map[string]string{"text": "ok", "placement": "append"}},
	}, []composition.Edge{{ID: "e0", Source: "t1", Target: "n1"}})
	if err != nil {
		t.Fatalf("CreateWorkflow(ok): %v", err)
	}
	failWF, err := comp.CreateWorkflow("Failing workflow", "", []composition.Node{
		{ID: "t1", NodeTypeID: "trigger-manual", Position: composition.Position{X: 0, Y: 0}},
		{ID: "n1", NodeTypeID: "test-home-fail", Position: composition.Position{X: 0, Y: 100}},
	}, []composition.Edge{{ID: "e0", Source: "t1", Target: "n1"}})
	if err != nil {
		t.Fatalf("CreateWorkflow(fail): %v", err)
	}
	// A triggered run executes the published snapshot (docs/adr/0021) --
	// both workflows must be published before RunKindTriggered will run
	// them at all.
	if _, err := comp.PublishWorkflow(okWF.ID); err != nil {
		t.Fatalf("PublishWorkflow(ok): %v", err)
	}
	if _, err := comp.PublishWorkflow(failWF.ID); err != nil {
		t.Fatalf("PublishWorkflow(fail): %v", err)
	}

	from := time.Now().Add(-time.Hour).UTC().Format(time.RFC3339)

	// Two successful triggered runs -- both should credit.
	if _, err := exec.RunWorkflow(okWF.ID, RunKindTriggered, nil); err != nil {
		t.Fatalf("RunWorkflow(ok, triggered #1): %v", err)
	}
	if _, err := exec.RunWorkflow(okWF.ID, RunKindTriggered, nil); err != nil {
		t.Fatalf("RunWorkflow(ok, triggered #2): %v", err)
	}
	// A successful TEST run of the same workflow -- must not credit
	// (authoring/preview, not automation replacing manual work).
	if _, err := exec.RunWorkflow(okWF.ID, RunKindTest, nil); err != nil {
		t.Fatalf("RunWorkflow(ok, test): %v", err)
	}
	// A FAILED triggered run -- must not credit (nothing was actually
	// automated).
	if _, err := exec.RunWorkflow(failWF.ID, RunKindTriggered, nil); err != nil {
		t.Fatalf("RunWorkflow(fail, triggered): %v", err)
	}

	to := time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
	metrics, err := exec.HomeMetrics(from, to, true)
	if err != nil {
		t.Fatalf("HomeMetrics: %v", err)
	}

	if metrics.TimeSaved.TotalMinutes != 10 {
		t.Errorf("TimeSaved.TotalMinutes = %d, want 10 (2 triggered-success runs × 5 min)", metrics.TimeSaved.TotalMinutes)
	}
	if len(metrics.TimeSaved.ByWorkflow) != 1 || metrics.TimeSaved.ByWorkflow[0].WorkflowID != okWF.ID {
		t.Fatalf("TimeSaved.ByWorkflow = %+v, want exactly the ok workflow", metrics.TimeSaved.ByWorkflow)
	}
	if got := metrics.TimeSaved.ByWorkflow[0]; got.RunCount != 2 || got.MinutesPerRun != 5 || got.TotalMinutes != 10 {
		t.Errorf("ByWorkflow[0] = %+v, want RunCount=2 MinutesPerRun=5 TotalMinutes=10", got)
	}

	// ErrorRate (includeTest=true) sees all 4 runs: 3 SUCCESS + 1 ERROR.
	if metrics.ErrorRate.SuccessCount != 3 || metrics.ErrorRate.ErrorCount != 1 {
		t.Errorf("ErrorRate = %+v, want SuccessCount=3 ErrorCount=1", metrics.ErrorRate)
	}

	// Ambient/MostUsed always see every run regardless of includeTest.
	if metrics.Ambient.TriggeredCount != 3 || metrics.Ambient.ManualCount != 1 {
		t.Errorf("Ambient = %+v, want TriggeredCount=3 ManualCount=1", metrics.Ambient)
	}
	if len(metrics.MostUsed) != 2 {
		t.Fatalf("MostUsed = %+v, want 2 workflows", metrics.MostUsed)
	}
}

// The integration proof for goal 0051 items 1/2 against a real DBOS
// runtime: AvgDuration/MostUsed's per-workflow AvgDurationSeconds and
// LastTriggeredAt are wired all the way from real recorded
// StartedAt/CompletedAt timestamps, not just their pure-function unit
// coverage above. Exact duration values aren't asserted (real wall-
// clock timing would make that flaky) -- only that a real sample was
// counted and a real (non-nil) average came out of it.
func TestHomeMetrics_AvgDurationAndLastTriggeredAt_WiredFromRealRuns(t *testing.T) {
	comp, exec := newHomeHarness(t)
	wf, err := comp.CreateWorkflow("Timed workflow", "", []composition.Node{
		{ID: "t1", NodeTypeID: "trigger-manual", Position: composition.Position{X: 0, Y: 0}},
		{ID: "n1", NodeTypeID: "process-inject-text", Position: composition.Position{X: 0, Y: 100},
			Config: map[string]string{"text": "ok", "placement": "append"}},
	}, []composition.Edge{{ID: "e0", Source: "t1", Target: "n1"}})
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}
	if _, err := comp.PublishWorkflow(wf.ID); err != nil {
		t.Fatalf("PublishWorkflow: %v", err)
	}

	before := time.Now()
	if _, err := exec.RunWorkflow(wf.ID, RunKindTriggered, nil); err != nil {
		t.Fatalf("RunWorkflow(triggered): %v", err)
	}
	// A TEST run afterward -- must count toward AvgDuration (a real
	// execution, timing-wise) but NOT toward LastTriggeredAt (goal
	// 0051 item 2's own "ambient runs only" rule).
	if _, err := exec.RunWorkflow(wf.ID, RunKindTest, nil); err != nil {
		t.Fatalf("RunWorkflow(test): %v", err)
	}
	after := time.Now()

	// The flake this pins down (BACKLOG debt 0a): RunWorkflow returns
	// before the run's completion record is necessarily queryable, so
	// HomeMetrics sometimes sampled one completed run instead of two.
	// Wait deterministically for both records to reach a terminal
	// state before querying.
	deadline := time.Now().Add(10 * time.Second)
	for {
		runs, err := exec.ListRunsForWorkflow(wf.ID)
		if err != nil {
			t.Fatalf("ListRunsForWorkflow: %v", err)
		}
		completed := 0
		for _, r := range runs {
			if !r.CompletedAt.IsZero() {
				completed++
			}
		}
		if completed >= 2 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("only %d of 2 runs completed within the wait window", completed)
		}
		time.Sleep(50 * time.Millisecond)
	}

	from := before.Add(-time.Minute).UTC().Format(time.RFC3339)
	to := after.Add(time.Minute).UTC().Format(time.RFC3339)
	metrics, err := exec.HomeMetrics(from, to, true)
	if err != nil {
		t.Fatalf("HomeMetrics: %v", err)
	}

	if metrics.AvgDuration.SampleSize != 2 {
		t.Errorf("AvgDuration.SampleSize = %d, want 2 (both real runs completed)", metrics.AvgDuration.SampleSize)
	}
	if metrics.AvgDuration.AvgSeconds == nil || *metrics.AvgDuration.AvgSeconds < 0 {
		t.Errorf("AvgDuration.AvgSeconds = %v, want a real non-negative value", metrics.AvgDuration.AvgSeconds)
	}

	if len(metrics.MostUsed) != 1 {
		t.Fatalf("MostUsed = %+v, want exactly the one workflow", metrics.MostUsed)
	}
	row := metrics.MostUsed[0]
	if row.AvgDurationSeconds == nil {
		t.Error("MostUsed[0].AvgDurationSeconds is nil, want a real value from its two completed runs")
	}
	if row.LastTriggeredAt == nil {
		t.Fatal("MostUsed[0].LastTriggeredAt is nil, want the triggered run's StartedAt")
	}
	// DBOS's own recorded StartedAt is millisecond-truncated (confirmed
	// directly: a real run's StartedAt can read slightly EARLIER than
	// an exact `before` captured with sub-millisecond precision, purely
	// from flooring to the millisecond) -- the lower bound floors the
	// same way so a genuinely-after-before event never spuriously fails.
	lowerBound := before.Truncate(time.Millisecond)
	if row.LastTriggeredAt.Before(lowerBound) || row.LastTriggeredAt.After(after) {
		t.Errorf("MostUsed[0].LastTriggeredAt = %v, want between %v and %v", row.LastTriggeredAt, lowerBound, after)
	}
}

// The date-range filter is real, not decorative: a HomeMetrics call
// whose window doesn't cover the run must not see it.
func TestHomeMetrics_DateRange_ExcludesRunsOutsideWindow(t *testing.T) {
	comp, exec := newHomeHarness(t)
	wf, err := comp.CreateWorkflow("Ranged workflow", "", []composition.Node{
		{ID: "t1", NodeTypeID: "trigger-manual", Position: composition.Position{X: 0, Y: 0}},
		{ID: "n1", NodeTypeID: "process-inject-text", Position: composition.Position{X: 0, Y: 100},
			Config: map[string]string{"text": "ok", "placement": "append"}},
	}, []composition.Edge{{ID: "e0", Source: "t1", Target: "n1"}})
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}
	if _, err := comp.PublishWorkflow(wf.ID); err != nil {
		t.Fatalf("PublishWorkflow: %v", err)
	}
	if _, err := exec.RunWorkflow(wf.ID, RunKindTriggered, nil); err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}

	future := time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339)
	farFuture := time.Now().Add(48 * time.Hour).UTC().Format(time.RFC3339)
	metrics, err := exec.HomeMetrics(future, farFuture, true)
	if err != nil {
		t.Fatalf("HomeMetrics: %v", err)
	}
	if len(metrics.MostUsed) != 0 || metrics.Ambient.TriggeredCount != 0 {
		t.Errorf("HomeMetrics(future window) = %+v, want no runs in range", metrics)
	}
}

func TestHomeMetrics_InvalidTimestamp_ReturnsError(t *testing.T) {
	_, exec := newHomeHarness(t)
	if _, err := exec.HomeMetrics("not-a-timestamp", time.Now().Format(time.RFC3339), false); err == nil {
		t.Error("HomeMetrics with an invalid from timestamp = nil error, want an error")
	}
}
