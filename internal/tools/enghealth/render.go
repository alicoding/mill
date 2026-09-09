package main

import (
	"fmt"
	"strings"
)

var categoryOrder = []string{"delivery", "ci", "test", "code", "platform", "dependencies", "machinery", "currency"}

var categoryTitle = map[string]string{
	"delivery":     "Delivery",
	"ci":           "CI",
	"test":         "Test",
	"code":         "Code",
	"platform":     "Platform",
	"dependencies": "Dependencies",
	"machinery":    "Machinery",
	"currency":     "Currency",
}

// RenderMarkdown produces the report body: one table per category,
// columns metric | 7d | 28d | budget | trend | status, matching the
// engineering-health issue's own body shape (contract item 1).
func RenderMarkdown(r Report) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# Engineering health\n\n")
	fmt.Fprintf(&b, "Generated %s UTC. Trailing %d and %d days.\n\n", r.GeneratedAtUTC, r.WindowDays[0], r.WindowDays[1])

	byCategory := map[string][]Metric{}
	for _, m := range r.Metrics {
		byCategory[m.Category] = append(byCategory[m.Category], m)
	}

	for _, cat := range categoryOrder {
		metrics := byCategory[cat]
		if len(metrics) == 0 {
			continue
		}
		fmt.Fprintf(&b, "## %s\n\n", categoryTitle[cat])
		fmt.Fprintf(&b, "| Metric | %dd | %dd | Budget | Trend | Status |\n", r.WindowDays[0], r.WindowDays[1])
		fmt.Fprintf(&b, "|---|---|---|---|---|---|\n")
		for _, m := range metrics {
			budget := m.BudgetDisplay
			if budget == "" {
				budget = "—"
			}
			status := m.StatusIcon()
			if status == "" {
				status = "—"
			}
			fmt.Fprintf(&b, "| %s | %s | %s | %s | %s | %s |\n",
				m.Name, m.Display7, m.Display28, budget, m.TrendArrow(), status)
		}
		fmt.Fprintf(&b, "\n")
	}

	return b.String()
}
