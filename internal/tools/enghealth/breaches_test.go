package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

// breachFrontMatter mirrors the shape the workflow's create-an-issue step
// and the label-creation/reopen steps both read: `labels` must parse as a
// YAML list, never a comma-joined string (goal 0413 S2b contract item 1 --
// the pinned action passes a scalar `labels` value to GitHub as ONE label
// literally containing the commas).
type breachFrontMatter struct {
	Title  string   `yaml:"title"`
	Labels []string `yaml:"labels"`
}

func writeBreachFixture(t *testing.T, m Metric) breachFrontMatter {
	t.Helper()
	dir := t.TempDir()
	if err := WriteBreaches(Report{Metrics: []Metric{m}}, dir); err != nil {
		t.Fatalf("WriteBreaches: %v", err)
	}
	raw, err := os.ReadFile(filepath.Join(dir, m.BudgetKey+".md")) // #nosec G304 -- a t.TempDir() path this test itself just wrote, not external input
	if err != nil {
		t.Fatalf("read breach file: %v", err)
	}
	return parseBreachFrontMatter(t, string(raw))
}

// parseBreachFrontMatter parses a breach markdown's own front matter with
// yaml.v3 -- shared with run_test.go's full-fixture assertions, so every
// caller checking `labels` does it as a real YAML list, never a
// string-contains check (goal 0413 S2b contract item 1).
func parseBreachFrontMatter(t *testing.T, doc string) breachFrontMatter {
	t.Helper()
	front, _, ok := splitFrontMatter(doc)
	if !ok {
		t.Fatalf("breach file has no --- front matter:\n%s", doc)
	}
	var fm breachFrontMatter
	if err := yaml.Unmarshal([]byte(front), &fm); err != nil {
		t.Fatalf("front matter is not valid YAML: %v\n%s", err, front)
	}
	return fm
}

// splitFrontMatter returns the text between the two leading "---" lines.
func splitFrontMatter(doc string) (front string, body string, ok bool) {
	const delim = "---\n"
	rest, hasPrefix := strings.CutPrefix(doc, delim)
	if !hasPrefix {
		return "", "", false
	}
	front, body, found := strings.Cut(rest, delim)
	if !found {
		return "", "", false
	}
	return front, body, true
}

func TestWriteBreaches_LabelsAreAYAMLList(t *testing.T) {
	fm := writeBreachFixture(t, Metric{
		Category:      "delivery",
		Name:          "Merge-group failure rate",
		BudgetKey:     "merge_group_failure_rate_pct_max",
		Class:         "ci-reliability",
		BudgetOp:      "le",
		BudgetDisplay: "10%",
		Display7:      "18%",
		Display28:     "12%",
		HasBudget:     true,
		HasData7:      true,
		Value7:        18,
		Budget:        10,
	})
	want := []string{"platform-health", "merge_group_failure_rate_pct_max"}
	if len(fm.Labels) != len(want) {
		t.Fatalf("Labels = %v, want %v", fm.Labels, want)
	}
	for i, w := range want {
		if fm.Labels[i] != w {
			t.Errorf("Labels[%d] = %q, want %q", i, fm.Labels[i], w)
		}
	}
}

func TestWriteBreaches_EscalateLabelOnSecondConsecutiveBreach(t *testing.T) {
	fm := writeBreachFixture(t, Metric{
		Category:      "delivery",
		Name:          "Merge-group failure rate",
		BudgetKey:     "merge_group_failure_rate_pct_max",
		Class:         "ci-reliability",
		BudgetOp:      "le",
		BudgetDisplay: "10%",
		Display7:      "18%",
		Display28:     "12%",
		HasBudget:     true,
		HasData7:      true,
		Value7:        18,
		Budget:        10,
		Consecutive:   2,
	})
	want := []string{"platform-health", "merge_group_failure_rate_pct_max", "escalate"}
	if len(fm.Labels) != len(want) {
		t.Fatalf("Labels = %v, want %v", fm.Labels, want)
	}
	for i, w := range want {
		if fm.Labels[i] != w {
			t.Errorf("Labels[%d] = %q, want %q", i, fm.Labels[i], w)
		}
	}
}

func TestWriteBreaches_NoFileForAMetricWithinBudget(t *testing.T) {
	dir := t.TempDir()
	report := Report{Metrics: []Metric{{
		BudgetKey: "lead_time_p50_hours_max",
		BudgetOp:  "le",
		HasBudget: true,
		HasData7:  true,
		Value7:    5,
		Budget:    24,
	}}}
	if err := WriteBreaches(report, dir); err != nil {
		t.Fatalf("WriteBreaches: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "lead_time_p50_hours_max.md")); !os.IsNotExist(err) {
		t.Fatalf("expected no breach file for a within-budget metric, stat err = %v", err)
	}
}
