package main

// ComputeTestHealth produces the retry-passed test signal and the
// QUARANTINE.md census.
func ComputeTestHealth(s Sources, b Budgets) []Metric {
	count7, rate7, ok7 := retryPassed(s.Playwright7, s.HasPlaywright7)
	count28, rate28, ok28 := retryPassed(s.Playwright28, s.HasPlaywright28)

	var quarNow, quarThen float64
	var okNow, okThen bool
	if s.HasQuarantineNow {
		n, k := CountActiveQuarantine(s.QuarantineNow)
		quarNow, okNow = float64(n), k
	}
	if s.HasQuarantine28dAgo {
		n, k := CountActiveQuarantine(s.Quarantine28dAgo)
		quarThen, okThen = float64(n), k
	}

	return []Metric{
		buildMetric("test", "Retry-passed test count", count7, ok7, count28, ok28, fmtCount, nil),
		buildMetric("test", "Retry-passed rate", rate7, ok7, rate28, ok28, fmtPct,
			&budgetSpec{b.RetryPassedRatePctMax, "le", fmtPct(b.RetryPassedRatePctMax)}),
		// The census is a point-in-time snapshot (current QUARANTINE.md)
		// compared against a 28-day-old snapshot from git history, not a
		// trailing-window count -- the "7d" column has no independent
		// meaning here, so it repeats the current reading (same shape
		// dependencies/machinery/platform/currency use below).
		buildMetric("test", "QUARANTINE active rows", quarNow, okNow, quarThen, okThen, fmtCount, nil),
	}
}

func retryPassed(report PlaywrightReport, has bool) (count, rate float64, ok bool) {
	if !has {
		return 0, 0, false
	}
	results := report.AllResults()
	if len(results) == 0 {
		return 0, 0, false
	}
	retryPassedN := 0
	for _, r := range results {
		if r.Status == "passed" && r.Retry > 0 {
			retryPassedN++
		}
	}
	return float64(retryPassedN), float64(retryPassedN) / float64(len(results)) * 100, true
}
