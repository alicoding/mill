package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// loadJSON decodes path into v. A missing file is not an error -- the
// metric it feeds simply reports "no data" (contract item 3: the tool
// always exits 0, reporting only). A malformed file is a warning on
// stderr, same graceful degradation, since one bad upstream artifact
// must never take down the whole weekly report.
func loadJSON(path string, v any) bool {
	raw, err := os.ReadFile(path) // #nosec G304 -- a fixed filename under this tool's own --data directory, not external input
	if err != nil {
		return false
	}
	if err := json.Unmarshal(raw, v); err != nil {
		fmt.Fprintf(os.Stderr, "enghealth: warning: %s: %v\n", path, err)
		return false
	}
	return true
}

// PRRecord is one merged (or still-open) pull request against main, the
// shape `gh pr list --json number,createdAt,mergedAt` already produces.
type PRRecord struct {
	Number    int        `json:"number"`
	CreatedAt time.Time  `json:"createdAt"`
	MergedAt  *time.Time `json:"mergedAt"`
}

// RunRecord is one workflow run, the shape `gh api
// repos/{owner}/{repo}/actions/runs` (per-run fields) produces.
type RunRecord struct {
	ID           int64     `json:"id"`
	Name         string    `json:"name"`
	Event        string    `json:"event"`
	HeadBranch   string    `json:"headBranch"`
	Conclusion   string    `json:"conclusion"`
	CreatedAt    time.Time `json:"createdAt"`
	RunStartedAt time.Time `json:"runStartedAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

// JobRecord is one job within a run, the shape `gh api
// repos/{owner}/{repo}/actions/runs/{id}/jobs` produces.
type JobRecord struct {
	RunID       int64     `json:"runId"`
	Name        string    `json:"name"`
	CreatedAt   time.Time `json:"createdAt"` // job queued
	StartedAt   time.Time `json:"startedAt"`
	CompletedAt time.Time `json:"completedAt"`
	Conclusion  string    `json:"conclusion"`
	Labels      []string  `json:"labels"`
}

// SimplePR is a minimal open-PR record (open Dependabot PRs, open goal
// PRs): number and when it was opened.
type SimplePR struct {
	Number    int       `json:"number"`
	CreatedAt time.Time `json:"createdAt"`
}

// RemergeRounds is precomputed by the workflow (a `git log --grep`
// walk over each merged PR's own commit history, per window) rather
// than recomputed in Go from a raw log dump: the source repository
// state needed (every merged goal PR's pre-squash history) isn't
// reconstructable from a single JSON snapshot the way the other
// sources are.
type RemergeRounds struct {
	Count7  int `json:"count7"`
	Count28 int `json:"count28"`
}

// Sources bundles every optional input the metric computations read.
// Each field's presence is independent -- a missing input degrades only
// the metrics it feeds, never the whole report.
type Sources struct {
	PRs                 []PRRecord
	Runs                []RunRecord
	Jobs                []JobRecord
	Dependabot          []SimplePR
	GoalPRs             []SimplePR
	Remerge             RemergeRounds
	HasRemerge          bool
	Playwright7         PlaywrightReport
	HasPlaywright7      bool
	Playwright28        PlaywrightReport
	HasPlaywright28     bool
	Golangci            GolangciReport
	HasGolangci         bool
	ESLint              []ESLintFileResult
	HasESLint           bool
	CoverOutPath        string
	HasCoverOut         bool
	VitestSummary       VitestCoverageSummary
	HasVitest           bool
	Currency            CurrencySet
	HasCurrency         bool
	QuarantineNow       string
	HasQuarantineNow    bool
	Quarantine28dAgo    string
	HasQuarantine28dAgo bool
	MaturityStable      int
	MaturityTotal       int
	HasMaturity         bool
	RepoRoot            string
}

// LoadSources reads every input file under dataDir plus the repo-truth
// files (QUARANTINE.md, the maturity ledger) under repoRoot.
func LoadSources(dataDir, repoRoot string) Sources {
	var s Sources
	s.RepoRoot = repoRoot

	loadJSON(filepath.Join(dataDir, "prs.json"), &s.PRs)
	loadJSON(filepath.Join(dataDir, "runs.json"), &s.Runs)
	loadJSON(filepath.Join(dataDir, "jobs.json"), &s.Jobs)
	loadJSON(filepath.Join(dataDir, "dependabot-prs.json"), &s.Dependabot)
	loadJSON(filepath.Join(dataDir, "goal-prs.json"), &s.GoalPRs)
	s.HasRemerge = loadJSON(filepath.Join(dataDir, "remerge-rounds.json"), &s.Remerge)
	// Two files, not one filtered in Go: Playwright's own JSON reporter
	// carries no per-test timestamp to filter by, so the workflow
	// aggregates each window's own main-branch run reports separately
	// (`gh run download` over runs found within each window) before
	// this tool ever sees them.
	s.HasPlaywright7 = loadJSON(filepath.Join(dataDir, "playwright-7.json"), &s.Playwright7)
	s.HasPlaywright28 = loadJSON(filepath.Join(dataDir, "playwright-28.json"), &s.Playwright28)
	s.HasGolangci = loadJSON(filepath.Join(dataDir, "golangci.json"), &s.Golangci)
	s.HasESLint = loadJSON(filepath.Join(dataDir, "eslint.json"), &s.ESLint)
	s.HasVitest = loadJSON(filepath.Join(dataDir, "coverage-summary.json"), &s.VitestSummary)
	s.HasCurrency = loadJSON(filepath.Join(dataDir, "currency.json"), &s.Currency)

	coverOut := filepath.Join(dataDir, "cover.out")
	if _, err := os.Stat(coverOut); err == nil {
		s.CoverOutPath = coverOut
		s.HasCoverOut = true
	}

	if raw, err := os.ReadFile(filepath.Join(dataDir, "quarantine-28d-ago.md")); err == nil { // #nosec G304 -- a fixed filename under --data
		s.Quarantine28dAgo = string(raw)
		s.HasQuarantine28dAgo = true
	}
	if raw, err := os.ReadFile(filepath.Join(repoRoot, "frontend", "e2e", "QUARANTINE.md")); err == nil { // #nosec G304 -- a fixed repo-owned path under --repo-root
		s.QuarantineNow = string(raw)
		s.HasQuarantineNow = true
	}

	if stable, total, ok := loadMaturity(repoRoot); ok {
		s.MaturityStable, s.MaturityTotal, s.HasMaturity = stable, total, true
	}

	return s
}
