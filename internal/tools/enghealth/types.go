// Package enghealth computes the weekly engineering-health report (goal
// 0413 S1): delivery, CI, test, code, platform, dependency, machinery and
// currency metrics against budgets, for the trailing 7 and 28 days. It is
// invoked by .github/workflows/engineering-health.yml, never a service --
// reporting only, no budget breach fails the run (S2 makes a breach open
// its own tracking issue).
package main

import "math"

// Metric is one row of the report table. Several categories (dependencies,
// machinery's open-PR count, platform, currency) are point-in-time state
// rather than a trailing-window rate; for those Value7 and Value28 are
// the same reading and Trend() always reports "->" since there is only
// one snapshot to compare against itself.
type Metric struct {
	Category string `json:"category"`
	Name     string `json:"name"`
	Unit     string `json:"unit"`

	HasData7 bool    `json:"hasData7"`
	Value7   float64 `json:"value7,omitempty"`
	Display7 string  `json:"display7"`

	HasData28 bool    `json:"hasData28"`
	Value28   float64 `json:"value28,omitempty"`
	Display28 string  `json:"display28"`

	HasBudget     bool    `json:"hasBudget"`
	Budget        float64 `json:"budget,omitempty"`
	BudgetOp      string  `json:"budgetOp,omitempty"` // "le" or "ge"
	BudgetDisplay string  `json:"budgetDisplay,omitempty"`
}

// TrendArrow compares the 7-day reading against the 28-day reading of the
// SAME metric. Both windows are trailing (not cumulative), so a metric
// whose 7-day value reads better/worse than its own 28-day value is a
// real directional signal, not noise from a growing denominator. Within
// 2% relative (or exact equality for whole-number counts) is flat.
func (m Metric) TrendArrow() string {
	if !m.HasData7 || !m.HasData28 {
		return "→" // ->
	}
	if m.Value7 == m.Value28 {
		return "→"
	}
	denom := math.Abs(m.Value28)
	if denom == 0 {
		denom = 1
	}
	rel := (m.Value7 - m.Value28) / denom
	if math.Abs(rel) < 0.02 {
		return "→"
	}
	if m.Value7 > m.Value28 {
		return "↑" // up
	}
	return "↓" // down
}

// StatusIcon evaluates the CURRENT (7-day) reading against the budget --
// the freshest signal is what should drive this week's status, even
// though the table also shows the 28-day column for context.
func (m Metric) StatusIcon() string {
	if !m.HasBudget || !m.HasData7 {
		return ""
	}
	switch m.BudgetOp {
	case "le":
		if m.Value7 <= m.Budget {
			return "✅" // check
		}
		return "⚠️" // warning
	case "ge":
		if m.Value7 >= m.Budget {
			return "✅"
		}
		return "⚠️"
	default:
		return ""
	}
}

// Report is the top-level JSON/MD document.
type Report struct {
	GeneratedAtUTC string   `json:"generatedAtUtc"`
	WindowDays     [2]int   `json:"windowDays"`
	Metrics        []Metric `json:"metrics"`
}
