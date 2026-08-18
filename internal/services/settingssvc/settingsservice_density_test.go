package settingssvc

import (
	"log/slog"
	"testing"

	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
	"github.com/alicoding/mill/internal/services/triggersvc"
)

func newDensityHarness(t *testing.T) *SettingsService {
	t.Helper()
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	trig := triggersvc.NewTriggerService(comp, slog.Default(), store)
	return NewSettingsService(store, trig, false)
}

func TestGetDisplayDensity_UnsetReturnsComfortable(t *testing.T) {
	set := newDensityHarness(t)
	if got := set.GetDisplayDensity(); got != DisplayDensityComfortable {
		t.Errorf("GetDisplayDensity(unset) = %q, want %q", got, DisplayDensityComfortable)
	}
}

func TestSetDisplayDensity_RoundTrips(t *testing.T) {
	set := newDensityHarness(t)
	if err := set.SetDisplayDensity(DisplayDensityCompact); err != nil {
		t.Fatalf("SetDisplayDensity(compact) error = %v, want nil", err)
	}
	if got := set.GetDisplayDensity(); got != DisplayDensityCompact {
		t.Errorf("GetDisplayDensity() = %q, want %q", got, DisplayDensityCompact)
	}
	if err := set.SetDisplayDensity(DisplayDensityComfortable); err != nil {
		t.Fatalf("SetDisplayDensity(comfortable) error = %v, want nil", err)
	}
	if got := set.GetDisplayDensity(); got != DisplayDensityComfortable {
		t.Errorf("GetDisplayDensity() = %q, want %q", got, DisplayDensityComfortable)
	}
}

func TestSetDisplayDensity_SurvivesAcrossServiceInstances(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	trig := triggersvc.NewTriggerService(comp, slog.Default(), store)
	first := NewSettingsService(store, trig, false)
	if err := first.SetDisplayDensity(DisplayDensityCompact); err != nil {
		t.Fatalf("SetDisplayDensity() error = %v, want nil", err)
	}

	second := NewSettingsService(store, trig, false)
	if got := second.GetDisplayDensity(); got != DisplayDensityCompact {
		t.Errorf("a fresh SettingsService over the same store: GetDisplayDensity() = %q, want %q", got, DisplayDensityCompact)
	}
}

func TestSetDisplayDensity_RejectsUnknownValue(t *testing.T) {
	set := newDensityHarness(t)
	if err := set.SetDisplayDensity("cozy"); err == nil {
		t.Error(`SetDisplayDensity("cozy") error = nil, want an error (only comfortable/compact are recognized)`)
	}
}
