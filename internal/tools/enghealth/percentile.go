package main

import "sort"

// Percentile returns the p-th percentile (0..100) of values using linear
// interpolation between closest ranks (the same method most CI dashboards
// and Playwright's own reporter percentile helpers use). values is not
// mutated. Empty input returns (0, false).
func Percentile(values []float64, p float64) (float64, bool) {
	if len(values) == 0 {
		return 0, false
	}
	sorted := make([]float64, len(values))
	copy(sorted, values)
	sort.Float64s(sorted)

	if len(sorted) == 1 {
		return sorted[0], true
	}

	rank := (p / 100) * float64(len(sorted)-1)
	lo := int(rank)
	hi := lo + 1
	if hi >= len(sorted) {
		return sorted[len(sorted)-1], true
	}
	frac := rank - float64(lo)
	return sorted[lo] + frac*(sorted[hi]-sorted[lo]), true
}

// Mean returns the arithmetic mean of values. Empty input returns (0, false).
func Mean(values []float64) (float64, bool) {
	if len(values) == 0 {
		return 0, false
	}
	var sum float64
	for _, v := range values {
		sum += v
	}
	return sum / float64(len(values)), true
}
