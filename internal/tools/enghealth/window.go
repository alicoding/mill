package main

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// ParseWindow parses the --window flag ("7,28") into the two trailing
// day-counts the report computes, shorter window first.
func ParseWindow(s string) ([2]int, error) {
	parts := strings.Split(s, ",")
	if len(parts) != 2 {
		return [2]int{}, fmt.Errorf("--window wants \"short,long\" (e.g. 7,28), got %q", s)
	}
	a, err1 := strconv.Atoi(strings.TrimSpace(parts[0]))
	b, err2 := strconv.Atoi(strings.TrimSpace(parts[1]))
	if err1 != nil || err2 != nil || a <= 0 || b <= 0 {
		return [2]int{}, fmt.Errorf("--window wants two positive integers, got %q", s)
	}
	if a > b {
		a, b = b, a
	}
	return [2]int{a, b}, nil
}

func cutoff(now time.Time, days int) time.Time {
	return now.AddDate(0, 0, -days)
}

// leadTimesHours returns PR-merge lead times (created -> merged), in
// hours, for PRs merged at or after cutoff.
func leadTimesHours(prs []PRRecord, since time.Time) []float64 {
	var out []float64
	for _, pr := range prs {
		if pr.MergedAt == nil || pr.MergedAt.Before(since) {
			continue
		}
		out = append(out, pr.MergedAt.Sub(pr.CreatedAt).Hours())
	}
	return out
}

func mergesCount(prs []PRRecord, since time.Time) int {
	n := 0
	for _, pr := range prs {
		if pr.MergedAt != nil && !pr.MergedAt.Before(since) {
			n++
		}
	}
	return n
}

func filterRuns(runs []RunRecord, since time.Time, pred func(RunRecord) bool) []RunRecord {
	var out []RunRecord
	for _, r := range runs {
		if r.CreatedAt.Before(since) {
			continue
		}
		if pred == nil || pred(r) {
			out = append(out, r)
		}
	}
	return out
}

func filterJobs(jobs []JobRecord, since time.Time, pred func(JobRecord) bool) []JobRecord {
	var out []JobRecord
	for _, j := range jobs {
		if j.CreatedAt.Before(since) {
			continue
		}
		if pred == nil || pred(j) {
			out = append(out, j)
		}
	}
	return out
}
