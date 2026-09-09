package main

import "fmt"

// ComputePlatform reads the plugin-API maturity ledger's stable/total
// count. Point-in-time (the ledger is regenerated from tracked content,
// not a trailing window), same reading both columns.
func ComputePlatform(s Sources) []Metric {
	display := func(v float64) string { return fmt.Sprintf("%d/%d", s.MaturityStable, s.MaturityTotal) }
	ratio := 0.0
	if s.HasMaturity && s.MaturityTotal > 0 {
		ratio = float64(s.MaturityStable) / float64(s.MaturityTotal) * 100
	}
	return []Metric{
		pointInTime("platform", "Maturity ledger stable/total", ratio, s.HasMaturity, display, nil),
	}
}
