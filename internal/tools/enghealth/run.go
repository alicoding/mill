package main

import "time"

// Config is every input Run needs. Now defaults to time.Now().UTC() in
// main.go; tests pin it for deterministic fixtures.
type Config struct {
	DataDir     string
	RepoRoot    string
	BudgetsPath string
	WindowDays  [2]int
	Now         time.Time
}

// Run computes the full report from a Config. It never errors on
// missing/partial data (contract item 3: the tool always exits 0) --
// the only real error is a missing/malformed budgets file, since
// without it no status can be marked at all.
func Run(cfg Config) (Report, error) {
	budgets, err := LoadBudgets(cfg.BudgetsPath)
	if err != nil {
		return Report{}, err
	}

	sources := LoadSources(cfg.DataDir, cfg.RepoRoot)

	metrics := make([]Metric, 0, 28) // delivery(5)+ci(5)+test(3)+code(6)+platform(1)+dependencies(2)+machinery(2)+currency(4)
	metrics = append(metrics, ComputeDelivery(sources, cfg.Now, cfg.WindowDays, budgets)...)
	metrics = append(metrics, ComputeCI(sources, cfg.Now, cfg.WindowDays, budgets)...)
	metrics = append(metrics, ComputeTestHealth(sources, budgets)...)
	metrics = append(metrics, ComputeCode(sources, budgets)...)
	metrics = append(metrics, ComputePlatform(sources)...)
	metrics = append(metrics, ComputeDependencies(sources, cfg.Now, budgets)...)
	metrics = append(metrics, ComputeMachinery(sources, budgets)...)
	metrics = append(metrics, ComputeCurrency(sources, budgets)...)

	return Report{
		GeneratedAtUTC: cfg.Now.UTC().Format(time.RFC3339),
		WindowDays:     cfg.WindowDays,
		Metrics:        metrics,
	}, nil
}
