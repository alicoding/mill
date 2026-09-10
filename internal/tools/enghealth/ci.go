package main

import "time"

// ComputeCI produces merge-group wall time, runner queue wait, jobs per
// run, and macOS-job share.
func ComputeCI(s Sources, now time.Time, windowDays [2]int, b Budgets) []Metric {
	c7, c28 := cutoff(now, windowDays[0]), cutoff(now, windowDays[1])

	isMergeGroup := func(r RunRecord) bool { return r.Event == "merge_group" }
	mg7 := filterRuns(s.Runs, c7, isMergeGroup)
	mg28 := filterRuns(s.Runs, c28, isMergeGroup)
	wall50v7, okW50v7 := Percentile(durationsMinutes(mg7), 50)
	wall50v28, okW50v28 := Percentile(durationsMinutes(mg28), 50)
	wall90v7, okW90v7 := Percentile(durationsMinutes(mg7), 90)
	wall90v28, okW90v28 := Percentile(durationsMinutes(mg28), 90)

	jobs7 := filterJobs(s.Jobs, c7, nil)
	jobs28 := filterJobs(s.Jobs, c28, nil)
	queue50v7, okQ7 := Percentile(queueWaitMinutes(jobs7), 50)
	queue50v28, okQ28 := Percentile(queueWaitMinutes(jobs28), 50)

	jpr7, okJpr7 := jobsPerRun(jobs7)
	jpr28, okJpr28 := jobsPerRun(jobs28)

	mac7, okMac7 := macOSShare(jobs7)
	mac28, okMac28 := macOSShare(jobs28)

	return []Metric{
		buildMetric("ci", "Merge-group wall time p50", wall50v7, okW50v7, wall50v28, okW50v28, fmtMinutes,
			&budgetSpec{Key: "merge_group_p50_minutes_max", Value: b.MergeGroupP50MinutesMax, Op: "le", Display: fmtMinutes(b.MergeGroupP50MinutesMax), Class: b.ClassFor("merge_group_p50_minutes_max")}),
		buildMetric("ci", "Merge-group wall time p90", wall90v7, okW90v7, wall90v28, okW90v28, fmtMinutes, nil),
		buildMetric("ci", "Runner queue wait p50", queue50v7, okQ7, queue50v28, okQ28, fmtMinutes,
			&budgetSpec{Key: "queue_wait_p50_minutes_max", Value: b.QueueWaitP50MinutesMax, Op: "le", Display: fmtMinutes(b.QueueWaitP50MinutesMax), Class: b.ClassFor("queue_wait_p50_minutes_max")}),
		buildMetric("ci", "Jobs per run", jpr7, okJpr7, jpr28, okJpr28, fmtCount, nil),
		buildMetric("ci", "macOS-job share", mac7, okMac7, mac28, okMac28, fmtPct, nil),
	}
}

func queueWaitMinutes(jobs []JobRecord) []float64 {
	var out []float64
	for _, j := range jobs {
		if j.StartedAt.Before(j.CreatedAt) {
			continue
		}
		out = append(out, j.StartedAt.Sub(j.CreatedAt).Minutes())
	}
	return out
}

func jobsPerRun(jobs []JobRecord) (float64, bool) {
	if len(jobs) == 0 {
		return 0, false
	}
	byRun := map[int64]int{}
	for _, j := range jobs {
		byRun[j.RunID]++
	}
	var counts []float64
	for _, n := range byRun {
		counts = append(counts, float64(n))
	}
	return Mean(counts)
}

func macOSShare(jobs []JobRecord) (float64, bool) {
	if len(jobs) == 0 {
		return 0, false
	}
	mac := 0
	for _, j := range jobs {
		for _, l := range j.Labels {
			if l == "macos" || l == "macos-latest" {
				mac++
				break
			}
		}
	}
	return float64(mac) / float64(len(jobs)) * 100, true
}
