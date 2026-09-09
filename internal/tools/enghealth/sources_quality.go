package main

import "golang.org/x/tools/cover"

// PlaywrightReport is the subset of Playwright's own JSON reporter shape
// (https://playwright.dev/docs/test-reporters#json-reporter) this tool
// reads: a recursive suite tree bottoming out in specs/tests/results.
type PlaywrightReport struct {
	Suites []PlaywrightSuite `json:"suites"`
}

type PlaywrightSuite struct {
	Suites []PlaywrightSuite `json:"suites"`
	Specs  []PlaywrightSpec  `json:"specs"`
}

type PlaywrightSpec struct {
	Tests []PlaywrightTest `json:"tests"`
}

type PlaywrightTest struct {
	Results []PlaywrightResult `json:"results"`
}

type PlaywrightResult struct {
	Status string `json:"status"`
	Retry  int    `json:"retry"`
}

// AllResults flattens the suite tree into its leaf results.
func (r PlaywrightReport) AllResults() []PlaywrightResult {
	var out []PlaywrightResult
	var walk func(suites []PlaywrightSuite)
	walk = func(suites []PlaywrightSuite) {
		for _, s := range suites {
			walk(s.Suites)
			for _, spec := range s.Specs {
				for _, t := range spec.Tests {
					out = append(out, t.Results...)
				}
			}
		}
	}
	walk(r.Suites)
	return out
}

// GolangciReport is golangci-lint's own `--out-format json` shape,
// narrowed to the FromLinter field this tool counts offenders by.
type GolangciReport struct {
	Issues []GolangciIssue `json:"Issues"`
}

type GolangciIssue struct {
	FromLinter string `json:"FromLinter"`
}

// ESLintFileResult is one element of eslint's own `-f json` array.
type ESLintFileResult struct {
	FilePath string          `json:"filePath"`
	Messages []ESLintMessage `json:"messages"`
}

type ESLintMessage struct {
	RuleID string `json:"ruleId"`
}

// VitestCoverageSummary is Istanbul's `json-summary` reporter shape
// (Vitest's own `coverage-summary.json`), narrowed to the `total.lines`
// figure this tool compares against the committed vite.config.ts floor.
type VitestCoverageSummary struct {
	Total struct {
		Lines struct {
			Pct float64 `json:"pct"`
		} `json:"lines"`
	} `json:"total"`
}

// GoCoveragePct parses a `go test -coverprofile` file via the standard
// golang.org/x/tools/cover profile reader (the same parser `go tool
// cover` itself is built on) and returns the statement-coverage
// percentage, matching what `go tool cover -func`'s own "total:" line
// reports.
func GoCoveragePct(path string) (float64, bool) {
	profiles, err := cover.ParseProfiles(path)
	if err != nil || len(profiles) == 0 {
		return 0, false
	}
	var covered, total int64
	for _, p := range profiles {
		for _, b := range p.Blocks {
			total += int64(b.NumStmt)
			if b.Count > 0 {
				covered += int64(b.NumStmt)
			}
		}
	}
	if total == 0 {
		return 0, false
	}
	return float64(covered) / float64(total) * 100, true
}
