package triggersvc

import (
	"log/slog"
	"testing"

	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// docs/goals/0010 item 2's third half: the seed's own Description
// promises "enable it ... and watch it start appearing in Activity
// each minute" -- proving that means proving Sync actually arms a real
// listener for the real seed once enabled, via ArmedWorkflows()
// (already the tested, real gate per triggerservice_test.go's own
// TestArmedWorkflows_ReflectsSyncsPublishedAndDisabledGate). The other
// two halves (triggered-run rejected while disabled, test-run works)
// live in executionsvc's own disabledschedule_seed_test.go -- this
// package needs a *TriggerService to observe arming at all, which that
// package can't construct without an import cycle.
func TestSeededDisabledScheduleExample_EnablingArmsTheSchedule(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	s := NewTriggerService(comp, slog.Default(), store)
	comp.SetSyncer(s)
	t.Cleanup(func() { s.Sync(nil) }) // stop every listener this test starts

	var wfID string
	for _, wf := range comp.Workflows() {
		if wf.Label == "Example: Disabled schedule" {
			wfID = wf.ID
		}
	}
	if wfID == "" {
		t.Fatal(`no built-in workflow labeled "Example: Disabled schedule"`)
	}

	// Ships disabled -- never armed, matching the seed's own promise.
	s.Sync(comp.Workflows())
	if s.ArmedWorkflows()[wfID] {
		t.Fatal("the disabled seed is armed before being enabled, want it never armed as shipped")
	}

	if _, err := comp.SetWorkflowDisabled(wfID, false); err != nil {
		t.Fatalf("SetWorkflowDisabled(false): %v", err)
	}

	if !s.ArmedWorkflows()[wfID] {
		t.Fatal("the seed is not armed after being enabled, want ArmedWorkflows() to report it live")
	}
}
