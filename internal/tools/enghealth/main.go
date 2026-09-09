// Command enghealth computes the weekly engineering-health report from
// repo truth and pre-gathered GitHub/lint/coverage/currency data (see
// Sources), invoked by .github/workflows/engineering-health.yml as
// `go run ./internal/tools/enghealth --window 7,28 --budgets
// .github/engineering-budgets.yml --out engineering-health.json --md
// engineering-health.md`.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

func main() {
	window := flag.String("window", "7,28", "trailing windows in days, short,long")
	budgetsPath := flag.String("budgets", ".github/engineering-budgets.yml", "budgets YAML file")
	outPath := flag.String("out", "engineering-health.json", "JSON report output path")
	mdPath := flag.String("md", "engineering-health.md", "markdown report output path")
	dataDir := flag.String("data", "enghealth-data", "directory of gathered gh api/lint/coverage/currency JSON inputs")
	repoRoot := flag.String("repo-root", ".", "repository root (for QUARANTINE.md, the maturity ledger, LOC-cap census)")
	flag.Parse()

	windowDays, err := ParseWindow(*window)
	if err != nil {
		fmt.Fprintln(os.Stderr, "enghealth:", err)
		os.Exit(1)
	}

	absRepoRoot, err := filepath.Abs(*repoRoot)
	if err != nil {
		fmt.Fprintln(os.Stderr, "enghealth:", err)
		os.Exit(1)
	}

	report, err := Run(Config{
		DataDir:     *dataDir,
		RepoRoot:    absRepoRoot,
		BudgetsPath: *budgetsPath,
		WindowDays:  windowDays,
		Now:         time.Now().UTC(),
	})
	if err != nil {
		// The one real failure mode: the budgets file itself is missing
		// or malformed, so no status could be marked at all.
		fmt.Fprintln(os.Stderr, "enghealth:", err)
		os.Exit(1)
	}

	jsonBytes, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		fmt.Fprintln(os.Stderr, "enghealth: marshal report:", err)
		os.Exit(1)
	}
	if err := os.WriteFile(*outPath, jsonBytes, 0o600); err != nil {
		fmt.Fprintln(os.Stderr, "enghealth: write", *outPath, ":", err)
		os.Exit(1)
	}
	if err := os.WriteFile(*mdPath, []byte(RenderMarkdown(report)), 0o600); err != nil {
		fmt.Fprintln(os.Stderr, "enghealth: write", *mdPath, ":", err)
		os.Exit(1)
	}
}
