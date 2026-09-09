package main

import "time"

// ComputeDependencies reads open Dependabot PRs: count and max age.
// Point-in-time (open PRs right now), same reading both columns.
func ComputeDependencies(s Sources, now time.Time, b Budgets) []Metric {
	has := s.Dependabot != nil
	count := float64(len(s.Dependabot))
	maxAge := 0.0
	for _, pr := range s.Dependabot {
		age := now.Sub(pr.CreatedAt).Hours() / 24
		if age > maxAge {
			maxAge = age
		}
	}
	return []Metric{
		pointInTime("dependencies", "Open Dependabot PRs", count, has, fmtCount, nil),
		pointInTime("dependencies", "Max Dependabot PR age", maxAge, has, fmtDays,
			&budgetSpec{b.DependabotPRAgeDaysMax, "le", fmtDays(b.DependabotPRAgeDaysMax)}),
	}
}
