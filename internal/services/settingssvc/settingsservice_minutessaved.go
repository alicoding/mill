package settingssvc

import (
	"encoding/json"
	"fmt"
)

// Split out of settingsservice.go, same "own file per self-contained
// concern" shape settingsservice_keymap.go/settingsservice_summonhotkey.go
// already established. docs/goals/0014-home-dashboard.md's Layer-1
// value accounting needs a per-workflow, user-editable "minutes saved
// per run" estimate -- this is that preference's owner. Read by
// ExecutionService.HomeMetrics via SetMinutesSavedLookup
// (executionservice_home.go, main.go), an injected function seam per
// .claude/rules/backend.md rather than a direct cross-service import,
// since SettingsService (not ExecutionService) owns Mill's persisted
// preferences (docs/SPEC.md §3.7).

// workflowMinutesSavedKey persists every workflow's OVERRIDE only --
// one atomic JSON blob (map[workflowID]minutes), same shape as
// keymapKey/summonHotkeyKey. A workflow with no entry is still on
// defaultWorkflowMinutesSaved -- mirrors ListKeybindings' own
// "override map, default lives elsewhere" split.
const workflowMinutesSavedKey = "settings-workflow-minutes-saved"

// defaultWorkflowMinutesSaved is Home's fallback per-run estimate when
// a workflow has no explicit override yet (goal 0014's "sensible
// default"). Mirrored in executionsvc.defaultMinutesSavedPerRun -- kept
// as two small constants rather than one shared package, since neither
// service may import the other (executionsvc is wired to this value
// only after both services already exist, via SetMinutesSavedLookup;
// see that method's own doc comment) and a third package for one int
// would be the exact "config surface for a decision that barely exists"
// pattern docs/SPEC.md §3.5 already warns against.
const defaultWorkflowMinutesSaved = 3

func (s *SettingsService) loadWorkflowMinutesSaved() map[string]int {
	raw, ok := s.store.Get(workflowMinutesSavedKey).(string)
	if !ok || raw == "" {
		return map[string]int{}
	}
	var m map[string]int
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		return map[string]int{}
	}
	return m
}

// GetWorkflowMinutesSaved returns workflowID's current minutes-saved
// estimate: its explicit override if SetWorkflowMinutesSaved was ever
// called for it, else defaultWorkflowMinutesSaved. This is the function
// value ExecutionService.SetMinutesSavedLookup wires in (main.go).
func (s *SettingsService) GetWorkflowMinutesSaved(workflowID string) int {
	if v, ok := s.loadWorkflowMinutesSaved()[workflowID]; ok {
		return v
	}
	return defaultWorkflowMinutesSaved
}

// ListWorkflowMinutesSaved returns every OVERRIDE only -- a workflow
// with no entry is still on the default. Home fetches this once per
// mount so its inline per-workflow edit control can show "still
// default" vs. an explicitly-set value, the same distinction
// ListKeybindings already draws for command bindings.
func (s *SettingsService) ListWorkflowMinutesSaved() map[string]int {
	return s.loadWorkflowMinutesSaved()
}

// SetWorkflowMinutesSaved overrides workflowID's estimate. minutes must
// be positive -- Home's own formula (RunCount × MinutesPerRun) always
// multiplies by this value, and crediting zero or negative time saved
// is meaningless, never a real user intent.
func (s *SettingsService) SetWorkflowMinutesSaved(workflowID string, minutes int) error {
	if workflowID == "" {
		return fmt.Errorf("workflowID is required")
	}
	if minutes <= 0 {
		return fmt.Errorf("minutes must be a positive number")
	}
	m := s.loadWorkflowMinutesSaved()
	m[workflowID] = minutes
	data, err := json.Marshal(m)
	if err != nil {
		return err
	}
	return s.store.Set(workflowMinutesSavedKey, string(data))
}
