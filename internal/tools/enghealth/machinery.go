package main

// ComputeMachinery reads open goal PRs (vs the WIP limit) and the
// shepherd re-merge-round count. Open-PR count is point-in-time;
// re-merge rounds are genuinely windowed (counted per trailing period
// by the workflow's own git-log walk).
func ComputeMachinery(s Sources, b Budgets) []Metric {
	hasGoalPRs := s.GoalPRs != nil
	count := float64(len(s.GoalPRs))

	remerge7, remerge28 := float64(s.Remerge.Count7), float64(s.Remerge.Count28)

	return []Metric{
		pointInTime("machinery", "Open goal PRs", count, hasGoalPRs, fmtCount,
			&budgetSpec{b.OpenGoalPRsMax, "le", fmtCount(b.OpenGoalPRsMax)}),
		buildMetric("machinery", "Shepherd re-merge rounds", remerge7, s.HasRemerge, remerge28, s.HasRemerge, fmtCount, nil),
	}
}
