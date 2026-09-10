package main

import (
	"fmt"
	"os"

	"gopkg.in/yaml.v3"
)

// Budgets is the decoded shape of .github/engineering-budgets.yml
// (goal 0413 S1 Decision 1, plus the currency thresholds goal 0419 S3
// folds in here rather than a separate job). A small Go type decoding
// real YAML via the already-vendored gopkg.in/yaml.v3 -- adopted, not a
// hand-rolled parser -- is what "yq-free YAML via a small Go tool" means:
// no `yq` CLI invocation from workflow bash.
type Budgets struct {
	LeadTimeP50HoursMax       float64 `yaml:"lead_time_p50_hours_max"`
	MergeGroupP50MinutesMax   float64 `yaml:"merge_group_p50_minutes_max"`
	QueueWaitP50MinutesMax    float64 `yaml:"queue_wait_p50_minutes_max"`
	MergeGroupFailureRatePct  float64 `yaml:"merge_group_failure_rate_pct_max"`
	RetryPassedRatePctMax     float64 `yaml:"retry_passed_rate_pct_max"`
	DependabotPRAgeDaysMax    float64 `yaml:"dependabot_pr_age_days_max"`
	OpenGoalPRsMax            float64 `yaml:"open_goal_prs_max"`
	FilesNearLOCCapMax        float64 `yaml:"files_near_loc_cap_max"`
	GoCoverageFloorPct        float64 `yaml:"go_coverage_floor_pct"`
	VitestCoverageFloorPct    float64 `yaml:"vitest_coverage_floor_pct"`
	GoMinorsBehindMax         float64 `yaml:"go_minors_behind_max"`
	NodeMinorsBehindMax       float64 `yaml:"node_minors_behind_max"`
	WailsBetasBehindMax       float64 `yaml:"wails_betas_behind_max"`
	PlaywrightMinorsBehindMax float64 `yaml:"playwright_minors_behind_max"`

	// Classes maps each budget's own YAML key (above) to the
	// defect/machinery class its breach becomes (goal 0413 S2 contract
	// item 1) -- a data table read from engineering-budgets.yml, never a
	// switch in Go. Every key in this struct gets a row (TestClassFor_
	// EveryBudgetHasAClass pins it); ClassFor falls back to
	// "unclassified" only for a row missing from the YAML file.
	Classes map[string]string `yaml:"classes"`
}

// ClassFor returns the defect/machinery class the given budget YAML key
// maps to, or "unclassified" if engineering-budgets.yml's classes table
// doesn't carry a row for it yet.
func (b Budgets) ClassFor(key string) string {
	if c, ok := b.Classes[key]; ok && c != "" {
		return c
	}
	return "unclassified"
}

// LoadBudgets decodes the budgets file at path.
func LoadBudgets(path string) (Budgets, error) {
	raw, err := os.ReadFile(path) // #nosec G304 -- an operator-supplied --budgets flag, not external/untrusted input
	if err != nil {
		return Budgets{}, fmt.Errorf("read budgets %s: %w", path, err)
	}
	var b Budgets
	if err := yaml.Unmarshal(raw, &b); err != nil {
		return Budgets{}, fmt.Errorf("parse budgets %s: %w", path, err)
	}
	return b, nil
}
