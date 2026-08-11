package settingssvc

import (
	"log/slog"
	"testing"

	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
	"github.com/alicoding/mill/internal/services/triggersvc"
)

func newMinutesSavedHarness(t *testing.T) *SettingsService {
	t.Helper()
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	trig := triggersvc.NewTriggerService(comp, slog.Default(), store)
	return NewSettingsService(store, trig, false)
}

func TestGetWorkflowMinutesSaved_UnsetReturnsDefault(t *testing.T) {
	set := newMinutesSavedHarness(t)
	if got := set.GetWorkflowMinutesSaved("no-such-workflow"); got != defaultWorkflowMinutesSaved {
		t.Errorf("GetWorkflowMinutesSaved(unset) = %d, want default %d", got, defaultWorkflowMinutesSaved)
	}
}

func TestSetWorkflowMinutesSaved_RoundTrips(t *testing.T) {
	set := newMinutesSavedHarness(t)
	if err := set.SetWorkflowMinutesSaved("wf-1", 10); err != nil {
		t.Fatalf("SetWorkflowMinutesSaved() error = %v, want nil", err)
	}
	if got := set.GetWorkflowMinutesSaved("wf-1"); got != 10 {
		t.Errorf("GetWorkflowMinutesSaved(wf-1) = %d, want 10", got)
	}
	// A different, never-set workflow stays on the default.
	if got := set.GetWorkflowMinutesSaved("wf-2"); got != defaultWorkflowMinutesSaved {
		t.Errorf("GetWorkflowMinutesSaved(wf-2) = %d, want default %d", got, defaultWorkflowMinutesSaved)
	}

	overrides := set.ListWorkflowMinutesSaved()
	if len(overrides) != 1 || overrides["wf-1"] != 10 {
		t.Errorf("ListWorkflowMinutesSaved() = %+v, want exactly {wf-1: 10}", overrides)
	}
}

func TestSetWorkflowMinutesSaved_SurvivesAcrossServiceInstances(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	trig := triggersvc.NewTriggerService(comp, slog.Default(), store)
	first := NewSettingsService(store, trig, false)
	if err := first.SetWorkflowMinutesSaved("wf-1", 7); err != nil {
		t.Fatalf("SetWorkflowMinutesSaved() error = %v, want nil", err)
	}

	second := NewSettingsService(store, trig, false)
	if got := second.GetWorkflowMinutesSaved("wf-1"); got != 7 {
		t.Errorf("a fresh SettingsService over the same store: GetWorkflowMinutesSaved(wf-1) = %d, want 7", got)
	}
}

func TestSetWorkflowMinutesSaved_RejectsNonPositive(t *testing.T) {
	set := newMinutesSavedHarness(t)
	for _, minutes := range []int{0, -1, -100} {
		if err := set.SetWorkflowMinutesSaved("wf-1", minutes); err == nil {
			t.Errorf("SetWorkflowMinutesSaved(%d) error = nil, want an error (minutes must be positive)", minutes)
		}
	}
}

func TestSetWorkflowMinutesSaved_RejectsEmptyWorkflowID(t *testing.T) {
	set := newMinutesSavedHarness(t)
	if err := set.SetWorkflowMinutesSaved("", 5); err == nil {
		t.Error("SetWorkflowMinutesSaved(\"\", 5) error = nil, want an error")
	}
}
