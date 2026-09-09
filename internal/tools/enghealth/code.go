package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
)

func compileRegex(pattern string) (*regexp.Regexp, error) {
	return regexp.Compile(pattern)
}

// locPolicy mirrors scripts/loc-policy.json -- the single source both
// scripts/check-loc.sh and this metric read, so the limit/exclude set
// can't drift between the two call sites.
type locPolicy struct {
	Limit        int    `json:"limit"`
	ExcludeRegex string `json:"exclude_regex"`
}

// listTrackedFiles lists a repo's git-tracked files -- the same
// read-only plumbing door check-loc.sh itself uses. A package var (not
// a bare call) so tests can substitute a fixed file list instead of
// running `git` against a fixture repo: git ls-files is discovery-
// sensitive to an inherited GIT_DIR/GIT_WORK_TREE (a pre-commit hook's
// own environment), the exact class scripts/lib/git-fixture.sh exists
// to isolate for bash fixtures -- avoided here by never invoking git at
// all in the test path.
var listTrackedFiles = func(repoRoot string) ([]string, error) {
	out, err := exec.Command("git", "-C", repoRoot, "ls-files").Output() //nolint:gosec // repoRoot is this tool's own --repo-root flag, not untrusted input; static git subcommand
	if err != nil {
		return nil, err
	}
	return strings.Split(string(out), "\n"), nil
}

// FilesNearLOCCap counts hand-written .go/.ts/.tsx files within 50 lines
// of scripts/loc-policy.json's own limit, reusing that file's limit and
// exclude set rather than a second hard-coded copy (check-loc.sh's own
// logic, shared, not copied).
func FilesNearLOCCap(repoRoot string) (int, bool) {
	raw, err := os.ReadFile(filepath.Join(repoRoot, "scripts", "loc-policy.json")) // #nosec G304 -- a fixed, this-repo-owned path under --repo-root
	if err != nil {
		return 0, false
	}
	var policy locPolicy
	if err := json.Unmarshal(raw, &policy); err != nil {
		return 0, false
	}
	exclude, err := compileRegex(policy.ExcludeRegex)
	if err != nil {
		return 0, false
	}

	files, err := listTrackedFiles(repoRoot)
	if err != nil {
		return 0, false
	}
	near := 0
	threshold := policy.Limit - 50
	for _, f := range files {
		if f == "" {
			continue
		}
		if !hasTrackedExt(f) || exclude.MatchString(f) {
			continue
		}
		lines, err := countLines(filepath.Join(repoRoot, f))
		if err != nil {
			continue
		}
		if lines >= threshold && lines <= policy.Limit {
			near++
		}
	}
	return near, true
}

func hasTrackedExt(f string) bool {
	switch filepath.Ext(f) {
	case ".go", ".ts", ".tsx":
		return true
	default:
		return false
	}
}

func countLines(path string) (int, error) {
	raw, err := os.ReadFile(path) // #nosec G304 -- path comes from git ls-files under --repo-root, not external input
	if err != nil {
		return 0, err
	}
	if len(raw) == 0 {
		return 0, nil
	}
	n := strings.Count(string(raw), "\n")
	if raw[len(raw)-1] != '\n' {
		n++
	}
	return n, nil
}

// GolangciOffenders counts golangci-lint issues from the named linter
// (e.g. "gocognit").
func GolangciOffenders(r GolangciReport, linter string) int {
	n := 0
	for _, issue := range r.Issues {
		if issue.FromLinter == linter {
			n++
		}
	}
	return n
}

// ESLintSonarjsOffenders counts eslint messages whose rule ID is under
// the sonarjs plugin.
func ESLintSonarjsOffenders(files []ESLintFileResult) int {
	n := 0
	for _, f := range files {
		for _, m := range f.Messages {
			if strings.HasPrefix(m.RuleID, "sonarjs/") {
				n++
			}
		}
	}
	return n
}

// CheckScriptCount counts scripts/check-*.sh gates.
func CheckScriptCount(repoRoot string) (int, bool) {
	matches, err := filepath.Glob(filepath.Join(repoRoot, "scripts", "check-*.sh"))
	if err != nil {
		return 0, false
	}
	return len(matches), true
}

// ComputeCode is a point-in-time snapshot (repo state right now), so
// every reading feeds both the 7d and 28d columns identically.
func ComputeCode(s Sources, b Budgets) []Metric {
	near, okNear := FilesNearLOCCap(s.RepoRoot)

	var cognit, sonar int
	okLint := s.HasGolangci || s.HasESLint
	if s.HasGolangci {
		cognit = GolangciOffenders(s.Golangci, "gocognit")
	}
	if s.HasESLint {
		sonar = ESLintSonarjsOffenders(s.ESLint)
	}

	goCov, okGoCov := 0.0, false
	if s.HasCoverOut {
		goCov, okGoCov = GoCoveragePct(s.CoverOutPath)
	}
	vitestCov, okVitestCov := 0.0, false
	if s.HasVitest {
		vitestCov, okVitestCov = s.VitestSummary.Total.Lines.Pct, true
	}

	checks, okChecks := CheckScriptCount(s.RepoRoot)

	return []Metric{
		pointInTime("code", "Files near LOC cap", float64(near), okNear, fmtCount,
			&budgetSpec{b.FilesNearLOCCapMax, "le", fmtCount(b.FilesNearLOCCapMax)}),
		pointInTime("code", "gocognit offenders", float64(cognit), okLint, fmtCount, nil),
		pointInTime("code", "sonarjs offenders", float64(sonar), okLint, fmtCount, nil),
		pointInTime("code", "Go coverage", goCov, okGoCov, fmtPct,
			&budgetSpec{b.GoCoverageFloorPct, "ge", fmtPct(b.GoCoverageFloorPct)}),
		pointInTime("code", "Vitest coverage (lines)", vitestCov, okVitestCov, fmtPct,
			&budgetSpec{b.VitestCoverageFloorPct, "ge", fmtPct(b.VitestCoverageFloorPct)}),
		pointInTime("code", "check-*.sh gate count", float64(checks), okChecks, fmtCount, nil),
	}
}
