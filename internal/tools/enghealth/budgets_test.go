package main

import "testing"

func TestLoadBudgets_Golden(t *testing.T) {
	b, err := LoadBudgets("testdata/budgets.yml")
	if err != nil {
		t.Fatal(err)
	}
	if b.LeadTimeP50HoursMax != 24 {
		t.Errorf("LeadTimeP50HoursMax = %v, want 24", b.LeadTimeP50HoursMax)
	}
	if b.OpenGoalPRsMax != 6 {
		t.Errorf("OpenGoalPRsMax = %v, want 6", b.OpenGoalPRsMax)
	}
	if b.WailsBetasBehindMax != 1 {
		t.Errorf("WailsBetasBehindMax = %v, want 1", b.WailsBetasBehindMax)
	}
}

func TestLoadBudgets_MissingFile(t *testing.T) {
	if _, err := LoadBudgets("testdata/does-not-exist.yml"); err == nil {
		t.Fatal("expected an error for a missing budgets file")
	}
}

// allBudgetKeys is every budget YAML key a Compute* function actually
// constructs a budgetSpec for (goal 0413 S2 contract item 1: "every
// budget gets one, the table is data") -- kept here, not derived from
// reflection, so a new budget field with no matching classes: row fails
// this test rather than silently reading "unclassified" at runtime.
var allBudgetKeys = []string{
	"lead_time_p50_hours_max",
	"merge_group_p50_minutes_max",
	"queue_wait_p50_minutes_max",
	"merge_group_failure_rate_pct_max",
	"retry_passed_rate_pct_max",
	"dependabot_pr_age_days_max",
	"open_goal_prs_max",
	"files_near_loc_cap_max",
	"go_coverage_floor_pct",
	"vitest_coverage_floor_pct",
	"go_minors_behind_max",
	"node_minors_behind_max",
	"wails_betas_behind_max",
	"playwright_minors_behind_max",
}

// TestClassFor_EveryBudgetHasAClass pins budgets.go's own promise (its
// Classes field doc comment) against both the test fixture and the real,
// shipped .github/engineering-budgets.yml -- a budget added without a
// classes: row would otherwise breach silently under "unclassified".
func TestClassFor_EveryBudgetHasAClass(t *testing.T) {
	for _, path := range []string{"testdata/budgets.yml", "../../../.github/engineering-budgets.yml"} {
		b, err := LoadBudgets(path)
		if err != nil {
			t.Fatalf("LoadBudgets(%s): %v", path, err)
		}
		for _, key := range allBudgetKeys {
			if got := b.ClassFor(key); got == "unclassified" {
				t.Errorf("%s: ClassFor(%q) = %q, want a real class", path, key, got)
			}
		}
	}
}

func TestClassFor_UnknownKeyFallsBackToUnclassified(t *testing.T) {
	b, err := LoadBudgets("testdata/budgets.yml")
	if err != nil {
		t.Fatal(err)
	}
	if got := b.ClassFor("no_such_budget_key"); got != "unclassified" {
		t.Errorf("ClassFor(unknown) = %q, want \"unclassified\"", got)
	}
}
