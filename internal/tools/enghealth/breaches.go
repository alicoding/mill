package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// LoadPreviousReport reads a prior run's engineering-health.json for
// Consecutive-breach tracking (contract item 1). Best-effort: an empty
// path, a missing file, or malformed JSON all resolve to no previous
// report (Consecutive starts at 1) rather than failing the run -- the
// same "no data" posture LoadSources takes for every other gathered
// input this tool doesn't own the freshness of.
func LoadPreviousReport(path string) *Report {
	if path == "" {
		return nil
	}
	raw, err := os.ReadFile(path) // #nosec G304 -- an operator-supplied --previous flag, not external input
	if err != nil {
		return nil
	}
	var r Report
	if err := json.Unmarshal(raw, &r); err != nil {
		return nil
	}
	return &r
}

// computeConsecutive counts how many runs in a row (including this one)
// the given metric has breached its budget. The previous report's own
// JSON is the only history this tool keeps, so the count chains through
// each week's Consecutive field rather than a separate ledger (contract
// item 1: "n if the previous report's JSON ... also breached this
// metric"). Only called for a metric that IS currently breaching.
func computeConsecutive(m Metric, prev *Report) int {
	if prev == nil {
		return 1
	}
	for _, pm := range prev.Metrics {
		if pm.BudgetKey != m.BudgetKey {
			continue
		}
		if pm.StatusIcon() != "⚠️" {
			return 1
		}
		if pm.Consecutive > 0 {
			return pm.Consecutive + 1
		}
		return 2
	}
	return 1
}

func opSymbol(op string) string {
	if op == "ge" {
		return "≥"
	}
	return "≤"
}

// WriteBreaches writes one <dir>/<budget-key>.md per currently-breached
// budget (StatusIcon "⚠️") -- front matter the workflow's create-an-issue
// step consumes directly (contract item 1). A metric within budget
// writes nothing. The title is quoted since "Platform health: <label>"
// itself contains ": ", ambiguous in unquoted YAML. `labels` is a YAML
// block list, never a comma-joined string: the pinned create-an-issue
// action passes the front matter's `labels` value to GitHub's create-issue
// API verbatim, so a comma-joined string becomes ONE label whose name
// contains a comma rather than several labels (goal 0413 S2b). Consecutive
// >= 2 folds the "escalate" label in here, computed once in Go rather than
// a second workflow-side label call.
func WriteBreaches(report Report, dir string) error {
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return fmt.Errorf("mkdir %s: %w", dir, err)
	}
	for _, m := range report.Metrics {
		if m.StatusIcon() != "⚠️" {
			continue
		}
		labels := []string{"platform-health", m.BudgetKey}
		if m.Consecutive >= 2 {
			labels = append(labels, "escalate")
		}

		var b strings.Builder
		fmt.Fprintf(&b, "---\n")
		fmt.Fprintf(&b, "title: %q\n", "Platform health: "+m.Name)
		fmt.Fprintf(&b, "labels:\n")
		for _, l := range labels {
			fmt.Fprintf(&b, "  - %s\n", l)
		}
		fmt.Fprintf(&b, "---\n\n")
		fmt.Fprintf(&b, "- **Category:** %s\n", categoryTitle[m.Category])
		fmt.Fprintf(&b, "- **Current (7d):** %s\n", m.Display7)
		fmt.Fprintf(&b, "- **Trailing (28d):** %s\n", m.Display28)
		fmt.Fprintf(&b, "- **Budget:** %s %s\n", opSymbol(m.BudgetOp), m.BudgetDisplay)
		fmt.Fprintf(&b, "- **Trend:** %s\n", m.TrendArrow())
		fmt.Fprintf(&b, "- **Class:** %s\n", m.Class)
		fmt.Fprintf(&b, "- **Consecutive:** %d\n", m.Consecutive)

		path := filepath.Join(dir, m.BudgetKey+".md")
		if err := os.WriteFile(path, []byte(b.String()), 0o600); err != nil {
			return fmt.Errorf("write %s: %w", path, err)
		}
	}
	return nil
}
