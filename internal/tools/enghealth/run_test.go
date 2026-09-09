package main

import (
	"os"
	"path/filepath"
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
