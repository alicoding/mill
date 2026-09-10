package main

import "fmt"

func fmtHours(v float64) string   { return fmt.Sprintf("%.1fh", v) }
func fmtMinutes(v float64) string { return fmt.Sprintf("%.1fmin", v) }
func fmtPct(v float64) string     { return fmt.Sprintf("%.1f%%", v) }
func fmtCount(v float64) string   { return fmt.Sprintf("%.0f", v) }
func fmtDays(v float64) string    { return fmt.Sprintf("%.1fd", v) }
func fmtLag(unit string) func(float64) string {
	return func(v float64) string { return fmt.Sprintf("%.0f %s behind", v, unit) }
}

// budgetSpec is a metric's threshold: HasBudget is implied by a non-nil
// *budgetSpec passed to buildMetric. Key is the budget's own YAML key in
// engineering-budgets.yml (also the breach file/issue-label suffix,
// goal 0413 S2 contract item 1); Class is that key's row in Budgets'
// Classes table.
type budgetSpec struct {
	Key     string
	Value   float64
	Op      string // "le" (breach when above) or "ge" (breach when below)
	Display string
	Class   string
}

// buildMetric assembles one report row from two independently-optional
// window readings (has7/has28 track "no data" -- e.g. zero PRs merged
// in a quiet week -- distinct from a real zero).
func buildMetric(category, name string, val7 float64, has7 bool, val28 float64, has28 bool, display func(float64) string, budget *budgetSpec) Metric {
	m := Metric{Category: category, Name: name}
	if has7 {
		m.HasData7 = true
		m.Value7 = val7
		m.Display7 = display(val7)
	} else {
		m.Display7 = "no data"
	}
	if has28 {
		m.HasData28 = true
		m.Value28 = val28
		m.Display28 = display(val28)
	} else {
		m.Display28 = "no data"
	}
	if budget != nil {
		m.HasBudget = true
		m.Budget = budget.Value
		m.BudgetOp = budget.Op
		m.BudgetDisplay = budget.Display
		m.BudgetKey = budget.Key
		m.Class = budget.Class
	}
	return m
}

// pointInTime is a shorthand for metrics that are current-state snapshots
// rather than trailing-window rates (dependencies, machinery's open-PR
// count, platform, currency): the same reading feeds both columns.
func pointInTime(category, name string, val float64, has bool, display func(float64) string, budget *budgetSpec) Metric {
	return buildMetric(category, name, val, has, val, has, display, budget)
}
