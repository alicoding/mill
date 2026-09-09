package main

// ComputeCurrency reads each toolchain's pinned-vs-latest lag. Point-in-
// time (a repo's pinned version right now), same reading both columns.
func ComputeCurrency(s Sources, b Budgets) []Metric {
	goLag, okGo := MinorsBehind(s.Currency.Go.Pinned, s.Currency.Go.Latest)
	nodeLag, okNode := MinorsBehind(s.Currency.Node.Pinned, s.Currency.Node.Latest)
	wailsLag, okWails := BetasBehind(s.Currency.Wails.Pinned, s.Currency.Wails.Latest)
	pwLag, okPw := MinorsBehind(s.Currency.Playwright.Pinned, s.Currency.Playwright.Latest)

	okGo = okGo && s.HasCurrency
	okNode = okNode && s.HasCurrency
	okWails = okWails && s.HasCurrency
	okPw = okPw && s.HasCurrency

	return []Metric{
		pointInTime("currency", "Go toolchain", float64(goLag), okGo, fmtLag("minors"),
			&budgetSpec{b.GoMinorsBehindMax, "le", fmtLag("minors")(b.GoMinorsBehindMax)}),
		pointInTime("currency", "Node", float64(nodeLag), okNode, fmtLag("minors"),
			&budgetSpec{b.NodeMinorsBehindMax, "le", fmtLag("minors")(b.NodeMinorsBehindMax)}),
		pointInTime("currency", "Wails", float64(wailsLag), okWails, fmtLag("betas"),
			&budgetSpec{b.WailsBetasBehindMax, "le", fmtLag("betas")(b.WailsBetasBehindMax)}),
		pointInTime("currency", "Playwright", float64(pwLag), okPw, fmtLag("minors"),
			&budgetSpec{b.PlaywrightMinorsBehindMax, "le", fmtLag("minors")(b.PlaywrightMinorsBehindMax)}),
	}
}
