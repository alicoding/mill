package pluginsvc

import "strings"

// conformBoardSwitcherFields is standard rule 31 (docs/goals/0357): a
// view placed in the board's own switcher whose scripts reach the
// field-write door -- api.content.setCardFields( in main.js, or the
// entry page's call('content.setCardFields') -- must declare the
// "edit-card-fields" capability, the same declare-first shape rule 3's
// unused-capability scan takes in reverse. The host would refuse the
// call at runtime either way; this names the missing declaration ahead
// of the load.
func conformBoardSwitcherFields(m Manifest, scripts map[string]string) []string {
	if hasCapability(m, "edit-card-fields") {
		return nil
	}
	switcherPlaced := false
	for _, v := range m.Contributes.Views {
		if v.Placement == "board-switcher" {
			switcherPlaced = true
			break
		}
	}
	if !switcherPlaced {
		return nil
	}
	var joined strings.Builder
	for _, src := range scripts {
		joined.WriteString(src)
		joined.WriteByte('\n')
	}
	all := joined.String()
	for _, marker := range capabilityUsageMarkers["edit-card-fields"] {
		if strings.Contains(all, marker) {
			return []string{`standard rule 31: a view placed in the board switcher that writes card fields must declare the "edit-card-fields" capability`}
		}
	}
	return nil
}
