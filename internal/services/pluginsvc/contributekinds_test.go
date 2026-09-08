package pluginsvc

import "testing"

// contributionKinds reads every family by reflection, and Menus is the
// one family shaped as a map rather than a slice (goal 0349 S2) --
// this pins that a non-empty map counts as "filled" the same way a
// non-empty slice does, so a menus-only plugin still gets a filter
// chip and an install-prompt line.
func TestContributionKinds_MenusMapCountsAsFilled(t *testing.T) {
	kinds := contributionKinds(ManifestContributes{
		Menus: map[string][]MenuItemContribution{"commandPalette": {{Command: "demo.run"}}},
	})
	found := false
	for _, k := range kinds {
		if k == "menus" {
			found = true
		}
	}
	if !found {
		t.Fatalf("contributionKinds = %v, want \"menus\" included", kinds)
	}
}

func TestContributionKinds_EmptyMenusMapNotFilled(t *testing.T) {
	kinds := contributionKinds(ManifestContributes{Menus: map[string][]MenuItemContribution{}})
	for _, k := range kinds {
		if k == "menus" {
			t.Fatalf("contributionKinds = %v, want \"menus\" excluded for an empty map", kinds)
		}
	}
}
