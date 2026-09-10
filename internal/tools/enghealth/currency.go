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
			&budgetSpec{Key: "go_minors_behind_max", Value: b.GoMinorsBehindMax, Op: "le", Display: fmtLag("minors")(b.GoMinorsBehindMax), Class: b.ClassFor("go_minors_behind_max")}),
		pointInTime("currency", "Node", float64(nodeLag), okNode, fmtLag("minors"),
			&budgetSpec{Key: "node_minors_behind_max", Value: b.NodeMinorsBehindMax, Op: "le", Display: fmtLag("minors")(b.NodeMinorsBehindMax), Class: b.ClassFor("node_minors_behind_max")}),
		pointInTime("currency", "Wails", float64(wailsLag), okWails, fmtLag("betas"),
			&budgetSpec{Key: "wails_betas_behind_max", Value: b.WailsBetasBehindMax, Op: "le", Display: fmtLag("betas")(b.WailsBetasBehindMax), Class: b.ClassFor("wails_betas_behind_max")}),
		pointInTime("currency", "Playwright", float64(pwLag), okPw, fmtLag("minors"),
			&budgetSpec{Key: "playwright_minors_behind_max", Value: b.PlaywrightMinorsBehindMax, Op: "le", Display: fmtLag("minors")(b.PlaywrightMinorsBehindMax), Class: b.ClassFor("playwright_minors_behind_max")}),
	}
}
