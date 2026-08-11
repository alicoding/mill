package executionsvc

import (
	"fmt"
	"sort"
	"time"

	"github.com/alicoding/mill/internal/adapters/execution"
)

// Home (docs/goals/0014-home-dashboard.md, docs/SPEC.md §3.2.3) is
// entirely a read model over already-checkpointed DBOS run history --
// zero new data is written to produce it (§1.1's zero-telemetry lock).
// Split out of executionservice.go, same "own file per self-contained
// concern" shape as executionservice_summary.go/executionservice_cancel.go
// before it.

// defaultMinutesSavedPerRun is Home's fallback per-workflow "minutes
// saved per run" estimate when no override exists yet -- mirrored in
// settingssvc.defaultWorkflowMinutesSaved (see that constant's own doc
// comment for why the two packages each carry their own copy of one
// small int rather than share a third package for it).
const defaultMinutesSavedPerRun = 3

// minBucketRunsForRate is the smallest terminal-run sample a daily
// bucket needs before its error-rate percentage is trusted -- goal
// 0014's own cited Datadog gotcha: one failed run out of one run total
// reads as "100% error rate," which is true but misleading at n=1. The
// bucket's raw Total/Success/Error counts are always returned regardless
// (goal 0014: "NEVER a bare percentage without its volume") -- only
// RatePercent itself is suppressed (nil) below this threshold, so the
// frontend can gray the rate while still showing the real counts that
// explain why.
const minBucketRunsForRate = 3

// SetMinutesSavedLookup wires SettingsService.GetWorkflowMinutesSaved
// (main.go, called once after SettingsService is constructed) -- see
// the ExecutionService struct's own doc comment on minutesSavedLookup
// for why this is an injected function rather than a direct import.
//
//wails:ignore
func (e *ExecutionService) SetMinutesSavedLookup(fn func(workflowID string) int) {
	e.minutesSavedLookup = fn
}

func (e *ExecutionService) minutesSavedFor(workflowID string) int {
	if e.minutesSavedLookup == nil {
		return defaultMinutesSavedPerRun
	}
	return e.minutesSavedLookup(workflowID)
}

// HomeMetrics is Home's one aggregate payload -- every field below is
// computed from the same run-history data ListRuns/ListRunsForWorkflow
// already expose, sliced and labeled differently for Home's specific
// questions (docs/goals/0014's three layers: value accounting, usage
// mirror, and -- not yet built, named future work -- the learning
// layer). IncludeTest widens ErrorRate/Series to also count "test"
// (manual/authoring) runs; TimeSaved and Ambient are unaffected by it
// on purpose -- see each field's own doc comment for why toggling test
// visibility would misstate what that specific number measures.
type HomeMetrics struct {
	From        string          `json:"from"`
	To          string          `json:"to"`
	IncludeTest bool            `json:"includeTest"`
	TimeSaved   TimeSavedMetric `json:"timeSaved"`
	ErrorRate   ErrorRateMetric `json:"errorRate"`
	Series      []DailyBucket   `json:"series"`
	MostUsed    []WorkflowUsage `json:"mostUsed"`
	Ambient     AmbientMetric   `json:"ambient"`
}

// TimeSavedMetric is docs/goals/0014's Layer-1 value accounting: minutes
// saved = Σ over Success + RunKind:triggered runs of that workflow's
// current minutes-saved estimate. A test run credits nothing (it's
// authoring/preview, not automation replacing manual work -- crediting
// it would be "Zapier crediting an editor preview," the goal's own
// framing) and a failed run credits nothing (nothing was actually
// automated) -- neither is affected by HomeMetrics' IncludeTest flag,
// which only widens the error-rate/series half.
type TimeSavedMetric struct {
	TotalMinutes int                 `json:"totalMinutes"`
	ByWorkflow   []WorkflowTimeSaved `json:"byWorkflow"`
}

// WorkflowTimeSaved is one workflow's contribution to TimeSavedMetric,
// carrying every factor of its own formula -- goal 0014: "31 runs × ~4
// min = ~2.1 hrs" must always be visible, never a bare total.
// MinutesPerRun is the estimate's current live value (SettingsService),
// so the frontend renders `RunCount × MinutesPerRun = TotalMinutes`
// directly without a second round trip.
type WorkflowTimeSaved struct {
	WorkflowID    string `json:"workflowID"`
	WorkflowLabel string `json:"workflowLabel"`
	RunCount      int    `json:"runCount"`
	MinutesPerRun int    `json:"minutesPerRun"`
	TotalMinutes  int    `json:"totalMinutes"`
}

// ErrorRateMetric is failed-terminal / (Success + Error terminal) --
// retry-then-success is Success, not a failure (DBOS's own step retry
// already absorbs this, per goal 0014). Cancelled and
// Pending/Enqueued/Delayed ("parked/waiting") runs are excluded from
// both counts entirely, not just from the rate. RatePercent is nil only
// when TotalTerminal is 0 (nothing to divide by) -- SuccessCount/
// ErrorCount are always real numbers, so a caller can never render a
// bare percentage without its own volume.
type ErrorRateMetric struct {
	SuccessCount  int      `json:"successCount"`
	ErrorCount    int      `json:"errorCount"`
	TotalTerminal int      `json:"totalTerminal"`
	RatePercent   *float64 `json:"ratePercent,omitempty"`
}

// DailyBucket is one local-timezone calendar day's run volume + error
// rate (goal 0014: daily buckets default, machine-local timezone
// unconditionally -- a single-viewer desktop app has no UTC/display
// split to reconcile). Total/Success/Error are always populated;
// RatePercent is suppressed (nil) below minBucketRunsForRate terminal
// runs -- the bucket's own counts stay visible regardless, so a grayed
// rate is never presented without the sample size that explains it.
type DailyBucket struct {
	Date        string   `json:"date"`
	Total       int      `json:"total"`
	Success     int      `json:"success"`
	Error       int      `json:"error"`
	RatePercent *float64 `json:"ratePercent,omitempty"`
}

// WorkflowUsage is one row of the most-used-workflows list -- every run
// in range counts, any Kind, any status (terminal or not) -- this
// measures raw usage frequency ("what do I actually reach for"), not
// automation correctness, which ErrorRate already owns separately.
type WorkflowUsage struct {
	WorkflowID    string `json:"workflowID"`
	WorkflowLabel string `json:"workflowLabel"`
	RunCount      int    `json:"runCount"`
}

// AmbientMetric is the ambient (triggered -- "Mill worked while the
// window was closed") vs. manual (test) fire ratio -- goal 0014 calls
// this "arguably THE metric." Always computed over every run in range
// regardless of HomeMetrics.IncludeTest, which only scopes ErrorRate/
// Series -- excluding test runs here would make the ratio unable to
// answer its own question.
type AmbientMetric struct {
	TriggeredCount int      `json:"triggeredCount"`
	ManualCount    int      `json:"manualCount"`
	AmbientPercent *float64 `json:"ambientPercent,omitempty"`
}

// HomeMetrics computes docs/goals/0014's full Home payload for every
// run created in [fromISO, toISO) (RFC3339 instants -- the frontend
// computes the boundary for its "last 7/30 days" selector directly, so
// Go only ever parses an exact instant, never a fuzzy date string).
// includeTest widens ErrorRate/Series to also count "test" runs -- see
// each returned field's own doc comment for which of the five numbers
// that flag actually affects.
func (e *ExecutionService) HomeMetrics(fromISO, toISO string, includeTest bool) (HomeMetrics, error) {
	from, err := time.Parse(time.RFC3339, fromISO)
	if err != nil {
		return HomeMetrics{}, fmt.Errorf("invalid from (want RFC3339): %w", err)
	}
	to, err := time.Parse(time.RFC3339, toISO)
	if err != nil {
		return HomeMetrics{}, fmt.Errorf("invalid to (want RFC3339): %w", err)
	}

	statuses, err := execution.ListWorkflows(e.ctx,
		execution.WithFilterName(millRunWorkflowName),
		execution.WithFilterCreatedAfter(from),
		execution.WithFilterCreatedBefore(to),
		execution.WithFilterSortDesc(),
	)
	if err != nil {
		return HomeMetrics{}, fmt.Errorf("home metrics: %w", err)
	}

	runs := make([]RunSummary, 0, len(statuses))
	for _, st := range statuses {
		runs = append(runs, e.summaryFromStatus(st))
	}

	scoped := make([]RunSummary, 0, len(runs))
	for _, r := range runs {
		if includeTest || r.Kind == RunKindTriggered {
			scoped = append(scoped, r)
		}
	}

	return HomeMetrics{
		From:        fromISO,
		To:          toISO,
		IncludeTest: includeTest,
		TimeSaved:   e.timeSavedFor(runs),
		ErrorRate:   errorRateFor(scoped),
		Series:      dailySeriesFor(scoped),
		MostUsed:    mostUsedFor(runs),
		Ambient:     ambientFor(runs),
	}, nil
}

// classifyStatus maps DBOS's raw status string onto the terminal
// success/failure split docs/goals/0014's error-rate formula needs.
// PENDING/ENQUEUED/DELAYED are "parked/waiting" (excluded from the
// denominator until resolved, the goal's own Zapier-convention
// citation); CANCELLED is excluded from both counts entirely (Airflow's
// "a deliberate stop is not a failure," also cited there).
// MAX_RECOVERY_ATTEMPTS_EXCEEDED counts as a failure -- DBOS gave up
// retrying, the same outcome an ERROR represents from Home's point of
// view.
func classifyStatus(status string) (success, failure bool) {
	switch status {
	case "SUCCESS":
		return true, false
	case "ERROR", "MAX_RECOVERY_ATTEMPTS_EXCEEDED":
		return false, true
	default:
		return false, false
	}
}

func (e *ExecutionService) timeSavedFor(runs []RunSummary) TimeSavedMetric {
	type acc struct {
		label string
		count int
	}
	byWorkflow := map[string]*acc{}
	var order []string
	for _, r := range runs {
		if r.Kind != RunKindTriggered || r.Status != "SUCCESS" {
			continue
		}
		a, ok := byWorkflow[r.WorkflowID]
		if !ok {
			a = &acc{label: r.WorkflowLabel}
			byWorkflow[r.WorkflowID] = a
			order = append(order, r.WorkflowID)
		}
		a.count++
	}

	var out TimeSavedMetric
	rows := make([]WorkflowTimeSaved, 0, len(order))
	for _, id := range order {
		a := byWorkflow[id]
		perRun := e.minutesSavedFor(id)
		total := a.count * perRun
		out.TotalMinutes += total
		rows = append(rows, WorkflowTimeSaved{
			WorkflowID: id, WorkflowLabel: a.label, RunCount: a.count,
			MinutesPerRun: perRun, TotalMinutes: total,
		})
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].TotalMinutes != rows[j].TotalMinutes {
			return rows[i].TotalMinutes > rows[j].TotalMinutes
		}
		return rows[i].WorkflowLabel < rows[j].WorkflowLabel
	})
	out.ByWorkflow = rows
	return out
}

func mostUsedFor(runs []RunSummary) []WorkflowUsage {
	type acc struct {
		label string
		count int
	}
	byWorkflow := map[string]*acc{}
	var order []string
	for _, r := range runs {
		a, ok := byWorkflow[r.WorkflowID]
		if !ok {
			a = &acc{label: r.WorkflowLabel}
			byWorkflow[r.WorkflowID] = a
			order = append(order, r.WorkflowID)
		}
		a.count++
	}
	out := make([]WorkflowUsage, 0, len(order))
	for _, id := range order {
		a := byWorkflow[id]
		out = append(out, WorkflowUsage{WorkflowID: id, WorkflowLabel: a.label, RunCount: a.count})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].RunCount != out[j].RunCount {
			return out[i].RunCount > out[j].RunCount
		}
		return out[i].WorkflowLabel < out[j].WorkflowLabel
	})
	return out
}

func ambientFor(runs []RunSummary) AmbientMetric {
	var m AmbientMetric
	for _, r := range runs {
		if r.Kind == RunKindTriggered {
			m.TriggeredCount++
		} else {
			m.ManualCount++
		}
	}
	total := m.TriggeredCount + m.ManualCount
	if total > 0 {
		pct := float64(m.TriggeredCount) / float64(total) * 100
		m.AmbientPercent = &pct
	}
	return m
}

func errorRateFor(runs []RunSummary) ErrorRateMetric {
	var m ErrorRateMetric
	for _, r := range runs {
		success, failure := classifyStatus(r.Status)
		switch {
		case success:
			m.SuccessCount++
		case failure:
			m.ErrorCount++
		}
	}
	m.TotalTerminal = m.SuccessCount + m.ErrorCount
	if m.TotalTerminal > 0 {
		pct := float64(m.ErrorCount) / float64(m.TotalTerminal) * 100
		m.RatePercent = &pct
	}
	return m
}

func dailySeriesFor(runs []RunSummary) []DailyBucket {
	buckets := map[string]*DailyBucket{}
	var order []string
	for _, r := range runs {
		success, failure := classifyStatus(r.Status)
		if !success && !failure {
			continue // parked/waiting or cancelled -- not part of daily volume+rate
		}
		day := r.StartedAt.In(time.Local).Format("2006-01-02")
		b, ok := buckets[day]
		if !ok {
			b = &DailyBucket{Date: day}
			buckets[day] = b
			order = append(order, day)
		}
		b.Total++
		if success {
			b.Success++
		} else {
			b.Error++
		}
	}
	sort.Strings(order)
	out := make([]DailyBucket, 0, len(order))
	for _, day := range order {
		b := buckets[day]
		if b.Total >= minBucketRunsForRate {
			pct := float64(b.Error) / float64(b.Total) * 100
			b.RatePercent = &pct
		}
		out = append(out, *b)
	}
	return out
}
