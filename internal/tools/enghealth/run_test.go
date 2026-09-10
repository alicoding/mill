package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// TestRun_Golden computes the full report from testdata/data + testdata/repo
// (a self-contained fixture mirroring one gathered week: gh api PR/run/job
// dumps, a Playwright JSON report per window, golangci-lint/eslint JSON, a
// Go coverprofile, a Vitest coverage-summary.json, Dependabot/goal PR
// lists, re-merge counts, currency readings, and QUARANTINE.md snapshots)
// and compares the rendered markdown against a committed golden file.
func TestRun_Golden(t *testing.T) {
	orig := listTrackedFiles
	defer func() { listTrackedFiles = orig }()
	listTrackedFiles = func(string) ([]string, error) {
		return []string{"near.go", "small.go"}, nil
	}

	repoRoot, err := filepath.Abs("testdata/repo")
	if err != nil {
		t.Fatal(err)
	}
	now, err := time.Parse(time.RFC3339, "2026-09-09T07:00:00Z")
	if err != nil {
		t.Fatal(err)
	}

	report, err := Run(Config{
		DataDir:     "testdata/data",
		RepoRoot:    repoRoot,
		BudgetsPath: "testdata/budgets.yml",
		WindowDays:  [2]int{7, 28},
		Now:         now,
	})
	if err != nil {
		t.Fatal(err)
	}

	byName := map[string]Metric{}
	for _, m := range report.Metrics {
		byName[m.Name] = m
	}

	// A handful of hand-computed values pin the core arithmetic
	// (percentile interpolation, rate/lag math) against the fixtures
	// above; the golden markdown below covers every row.
	leadP50 := byName["PR lead time p50"]
	if leadP50.Display7 != "13.5h" {
		t.Errorf("PR lead time p50 (7d) = %s, want 13.5h", leadP50.Display7)
	}
	if leadP50.Display28 != "24.0h" {
		t.Errorf("PR lead time p50 (28d) = %s, want 24.0h", leadP50.Display28)
	}
	if leadP50.StatusIcon() != "✅" {
		t.Errorf("PR lead time p50 status = %q, want a pass (7d value 13.5h is under the 24h budget)", leadP50.StatusIcon())
	}

	failRate := byName["Merge-group failure rate"]
	if failRate.Display7 != "50.0%" {
		t.Errorf("Merge-group failure rate (7d) = %s, want 50.0%%", failRate.Display7)
	}

	quarantine := byName["QUARANTINE active rows"]
	if quarantine.Display7 != "2" || quarantine.Display28 != "3" {
		t.Errorf("QUARANTINE active rows = %s/%s, want 2/3", quarantine.Display7, quarantine.Display28)
	}

	goCurrency := byName["Go toolchain"]
	if goCurrency.Display7 != "1 minors behind" {
		t.Errorf("Go toolchain lag = %s, want \"1 minors behind\"", goCurrency.Display7)
	}
	if goCurrency.StatusIcon() != "✅" {
		t.Errorf("Go toolchain status = %q, want a pass (1 <= budget 1)", goCurrency.StatusIcon())
	}

	golden := filepath.Join("testdata", "golden", "engineering-health.md")
	got := RenderMarkdown(report)
	if os.Getenv("ENGHEALTH_UPDATE_GOLDEN") == "1" {
		if err := os.WriteFile(golden, []byte(got), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	want, err := os.ReadFile(golden) // #nosec G304 -- a fixed testdata path, not external input
	if err != nil {
		t.Fatal(err)
	}
	if got != string(want) {
		t.Errorf("markdown mismatch (rerun with ENGHEALTH_UPDATE_GOLDEN=1 after confirming the new output is correct):\n--- got ---\n%s\n--- want ---\n%s", got, string(want))
	}
}

// fixtureConfig returns the same Config TestRun_Golden uses, so the
// breach-writing tests below run against the same known breach set (the
// golden markdown's own "## Breaches" section: merge-group failure
// rate, retry-passed rate, Go coverage, max Dependabot PR age,
// Playwright currency) rather than a second, drifting fixture.
func fixtureConfig(t *testing.T) Config {
	t.Helper()
	orig := listTrackedFiles
	t.Cleanup(func() { listTrackedFiles = orig })
	listTrackedFiles = func(string) ([]string, error) {
		return []string{"near.go", "small.go"}, nil
	}
	repoRoot, err := filepath.Abs("testdata/repo")
	if err != nil {
		t.Fatal(err)
	}
	now, err := time.Parse(time.RFC3339, "2026-09-09T07:00:00Z")
	if err != nil {
		t.Fatal(err)
	}
	return Config{
		DataDir:     "testdata/data",
		RepoRoot:    repoRoot,
		BudgetsPath: "testdata/budgets.yml",
		WindowDays:  [2]int{7, 28},
		Now:         now,
	}
}

// TestRun_WritesOneFilePerBreach proves contract item 1's two named
// branches: a breached budget gets its own <budget-key>.md (front
// matter title/labels plus the reading/budget/trend/class/Consecutive
// body), and a metric within budget writes nothing at all.
func TestRun_WritesOneFilePerBreach(t *testing.T) {
	cfg := fixtureConfig(t)
	cfg.BreachesDir = t.TempDir()

	if _, err := Run(cfg); err != nil {
		t.Fatal(err)
	}

	wantBreached := []string{
		"merge_group_failure_rate_pct_max.md",
		"retry_passed_rate_pct_max.md",
		"go_coverage_floor_pct.md",
		"dependabot_pr_age_days_max.md",
		"playwright_minors_behind_max.md",
	}
	for _, name := range wantBreached {
		if _, err := os.Stat(filepath.Join(cfg.BreachesDir, name)); err != nil {
			t.Errorf("expected breach file %s: %v", name, err)
		}
	}

	// PR lead time p50 (7d 13.5h) is well under its 24h budget in this
	// fixture -- a passing metric writes nothing.
	if _, err := os.Stat(filepath.Join(cfg.BreachesDir, "lead_time_p50_hours_max.md")); !os.IsNotExist(err) {
		t.Errorf("lead_time_p50_hours_max.md exists for a within-budget metric, err = %v", err)
	}

	raw, err := os.ReadFile(filepath.Join(cfg.BreachesDir, "retry_passed_rate_pct_max.md"))
	if err != nil {
		t.Fatal(err)
	}
	body := string(raw)
	for _, want := range []string{
		`title: "Platform health: Retry-passed rate"`,
		"**Current (7d):** 33.3%",
		"**Trailing (28d):** 16.7%",
		"**Budget:** ≤ 1.0%",
		"**Trend:** ↑",
		"**Class:** flake",
		"**Consecutive:** 1",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("retry_passed_rate_pct_max.md missing %q, got:\n%s", want, body)
		}
	}
	// `labels` is a YAML block list, never a comma-joined scalar (goal
	// 0413 S2b): parsed with yaml.v3, never a string-contains check.
	fm := parseBreachFrontMatter(t, body)
	wantLabels := []string{"platform-health", "retry_passed_rate_pct_max"}
	if len(fm.Labels) != len(wantLabels) {
		t.Fatalf("Labels = %v, want %v", fm.Labels, wantLabels)
	}
	for i, w := range wantLabels {
		if fm.Labels[i] != w {
			t.Errorf("Labels[%d] = %q, want %q", i, fm.Labels[i], w)
		}
	}
	// First run (no --previous): Consecutive is 1, so escalate is absent.
	if strings.Contains(body, "escalate") {
		t.Errorf("retry_passed_rate_pct_max.md carries escalate on a first run:\n%s", body)
	}
}

// TestRun_ConsecutiveChainsThroughPreviousReportAndEscalates proves the
// other half of contract item 1: a metric that also breached in the
// --previous report's own JSON increments Consecutive, and >= 2 adds
// the escalate label the workflow doesn't have to compute itself.
func TestRun_ConsecutiveChainsThroughPreviousReportAndEscalates(t *testing.T) {
	prev := Report{
		Metrics: []Metric{
			{
				Category: "test", Name: "Retry-passed rate",
				HasData7: true, Value7: 5, Display7: "5.0%",
				HasBudget: true, Budget: 1, BudgetOp: "le", BudgetDisplay: "1.0%",
				BudgetKey: "retry_passed_rate_pct_max", Consecutive: 2,
			},
		},
	}
	raw, err := json.Marshal(prev)
	if err != nil {
		t.Fatal(err)
	}
	prevPath := filepath.Join(t.TempDir(), "previous.json")
	if err := os.WriteFile(prevPath, raw, 0o600); err != nil {
		t.Fatal(err)
	}

	cfg := fixtureConfig(t)
	cfg.BreachesDir = t.TempDir()
	cfg.PreviousPath = prevPath

	report, err := Run(cfg)
	if err != nil {
		t.Fatal(err)
	}

	var got Metric
	for _, m := range report.Metrics {
		if m.BudgetKey == "retry_passed_rate_pct_max" {
			got = m
		}
	}
	if got.Consecutive != 3 {
		t.Errorf("Consecutive = %d, want 3 (previous report's 2 + this breach)", got.Consecutive)
	}

	raw, err = os.ReadFile(filepath.Join(cfg.BreachesDir, "retry_passed_rate_pct_max.md"))
	if err != nil {
		t.Fatal(err)
	}
	body := string(raw)
	fm := parseBreachFrontMatter(t, body)
	wantLabels := []string{"platform-health", "retry_passed_rate_pct_max", "escalate"}
	if len(fm.Labels) != len(wantLabels) {
		t.Fatalf("Labels = %v, want %v", fm.Labels, wantLabels)
	}
	for i, w := range wantLabels {
		if fm.Labels[i] != w {
			t.Errorf("Labels[%d] = %q, want %q", i, fm.Labels[i], w)
		}
	}
	if !strings.Contains(body, "**Consecutive:** 3") {
		t.Errorf("expected Consecutive: 3 in the body, got:\n%s", body)
	}
}

// TestComputeConsecutive_Branches unit-tests every branch computeConsecutive
// can take, independent of the full fixture above.
func TestComputeConsecutive_Branches(t *testing.T) {
	breaching := Metric{
		BudgetKey: "k", HasData7: true, Value7: 10,
		HasBudget: true, Budget: 1, BudgetOp: "le",
	}

	t.Run("no previous report", func(t *testing.T) {
		if got := computeConsecutive(breaching, nil); got != 1 {
			t.Errorf("got %d, want 1", got)
		}
	})

	t.Run("previous breached the same key, pre-S2 zero Consecutive", func(t *testing.T) {
		prev := &Report{Metrics: []Metric{
			{BudgetKey: "k", HasData7: true, Value7: 9, HasBudget: true, Budget: 1, BudgetOp: "le"},
		}}
		if got := computeConsecutive(breaching, prev); got != 2 {
			t.Errorf("got %d, want 2", got)
		}
	})

	t.Run("previous breached the same key, chains its own Consecutive", func(t *testing.T) {
		prev := &Report{Metrics: []Metric{
			{BudgetKey: "k", HasData7: true, Value7: 9, HasBudget: true, Budget: 1, BudgetOp: "le", Consecutive: 4},
		}}
		if got := computeConsecutive(breaching, prev); got != 5 {
			t.Errorf("got %d, want 5", got)
		}
	})

	t.Run("previous passed the same key", func(t *testing.T) {
		prev := &Report{Metrics: []Metric{
			{BudgetKey: "k", HasData7: true, Value7: 0.5, HasBudget: true, Budget: 1, BudgetOp: "le"},
		}}
		if got := computeConsecutive(breaching, prev); got != 1 {
			t.Errorf("got %d, want 1", got)
		}
	})

	t.Run("previous report never carried this key", func(t *testing.T) {
		prev := &Report{Metrics: []Metric{
			{BudgetKey: "other", HasData7: true, Value7: 9, HasBudget: true, Budget: 1, BudgetOp: "le"},
		}}
		if got := computeConsecutive(breaching, prev); got != 1 {
			t.Errorf("got %d, want 1", got)
		}
	})
}

func TestLoadPreviousReport_MissingOrMalformedIsNil(t *testing.T) {
	if got := LoadPreviousReport(""); got != nil {
		t.Errorf("empty path: got %v, want nil", got)
	}
	if got := LoadPreviousReport(filepath.Join(t.TempDir(), "does-not-exist.json")); got != nil {
		t.Errorf("missing file: got %v, want nil", got)
	}
	badPath := filepath.Join(t.TempDir(), "bad.json")
	if err := os.WriteFile(badPath, []byte("not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := LoadPreviousReport(badPath); got != nil {
		t.Errorf("malformed file: got %v, want nil", got)
	}
}
