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
