package main

import "time"

// ComputeDelivery produces the DORA-shaped delivery metrics: PR lead time
// (created -> merged), merges/week, merge-group failure rate, and
// time-to-green on main.
func ComputeDelivery(s Sources, now time.Time, windowDays [2]int, b Budgets) []Metric {
	c7, c28 := cutoff(now, windowDays[0]), cutoff(now, windowDays[1])

	lt7 := leadTimesHours(s.PRs, c7)
	lt28 := leadTimesHours(s.PRs, c28)
	p50v7, ok50v7 := Percentile(lt7, 50)
	p50v28, ok50v28 := Percentile(lt28, 50)
	p90v7, ok90v7 := Percentile(lt7, 90)
	p90v28, ok90v28 := Percentile(lt28, 90)

	merges7 := float64(mergesCount(s.PRs, c7))
	merges28 := float64(mergesCount(s.PRs, c28))
	perWeek7 := merges7 / (float64(windowDays[0]) / 7)
	perWeek28 := merges28 / (float64(windowDays[1]) / 7)

	isMergeGroup := func(r RunRecord) bool { return r.Event == "merge_group" }
	mg7 := filterRuns(s.Runs, c7, isMergeGroup)
	mg28 := filterRuns(s.Runs, c28, isMergeGroup)
	failRate7, okFail7 := failureRate(mg7)
	failRate28, okFail28 := failureRate(mg28)

	isMainPush := func(r RunRecord) bool {
		return r.Event == "push" && r.HeadBranch == "main" && r.Conclusion == "success"
	}
	green7 := filterRuns(s.Runs, c7, isMainPush)
	green28 := filterRuns(s.Runs, c28, isMainPush)
	ttg50v7, okTtg7 := Percentile(durationsMinutes(green7), 50)
	ttg50v28, okTtg28 := Percentile(durationsMinutes(green28), 50)

	return []Metric{
		buildMetric("delivery", "PR lead time p50", p50v7, ok50v7, p50v28, ok50v28, fmtHours,
			&budgetSpec{b.LeadTimeP50HoursMax, "le", fmtHours(b.LeadTimeP50HoursMax)}),
		buildMetric("delivery", "PR lead time p90", p90v7, ok90v7, p90v28, ok90v28, fmtHours, nil),
		buildMetric("delivery", "Merges/week", perWeek7, true, perWeek28, true, fmtCount, nil),
		buildMetric("delivery", "Merge-group failure rate", failRate7, okFail7, failRate28, okFail28, fmtPct,
			&budgetSpec{b.MergeGroupFailureRatePct, "le", fmtPct(b.MergeGroupFailureRatePct)}),
		buildMetric("delivery", "Time-to-green on main p50", ttg50v7, okTtg7, ttg50v28, okTtg28, fmtMinutes, nil),
	}
}

func failureRate(runs []RunRecord) (float64, bool) {
	if len(runs) == 0 {
		return 0, false
	}
	failed := 0
	for _, r := range runs {
		if r.Conclusion == "failure" {
			failed++
		}
	}
	return float64(failed) / float64(len(runs)) * 100, true
}

func durationsMinutes(runs []RunRecord) []float64 {
	out := make([]float64, 0, len(runs))
	for _, r := range runs {
		out = append(out, r.UpdatedAt.Sub(r.CreatedAt).Minutes())
	}
	return out
}
