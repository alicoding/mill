package settingssvc

import (
	"log/slog"
	"testing"

	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/servicetest"
	"github.com/alicoding/mill/internal/services/triggersvc"
)

func newExtensionsHarness(t *testing.T) *SettingsService {
	t.Helper()
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	trig := triggersvc.NewTriggerService(comp, slog.Default(), store)
	return NewSettingsService(store, trig, false)
}

func TestGetDisabledExtensions_UnsetReturnsEmpty(t *testing.T) {
	set := newExtensionsHarness(t)
	got := set.GetDisabledExtensions()
	if len(got) != 0 {
		t.Errorf("GetDisabledExtensions(unset) = %v, want empty", got)
	}
}

func TestSetExtensionEnabled_RoundTrips(t *testing.T) {
	set := newExtensionsHarness(t)
	if err := set.SetExtensionEnabled("pencil", false); err != nil {
		t.Fatalf("SetExtensionEnabled(pencil, false) error = %v, want nil", err)
	}
	got := set.GetDisabledExtensions()
	if len(got) != 1 || got[0] != "pencil" {
		t.Errorf("GetDisabledExtensions() = %v, want [pencil]", got)
	}

	if err := set.SetExtensionEnabled("pencil", true); err != nil {
		t.Fatalf("SetExtensionEnabled(pencil, true) error = %v, want nil", err)
	}
	got = set.GetDisabledExtensions()
	if len(got) != 0 {
		t.Errorf("GetDisabledExtensions() after re-enabling = %v, want empty", got)
	}
}

func TestSetExtensionEnabled_MultipleIdsIndependent(t *testing.T) {
	set := newExtensionsHarness(t)
	if err := set.SetExtensionEnabled("pencil", false); err != nil {
		t.Fatalf("SetExtensionEnabled(pencil, false) error = %v", err)
	}
	if err := set.SetExtensionEnabled("laser", false); err != nil {
		t.Fatalf("SetExtensionEnabled(laser, false) error = %v", err)
	}
	got := set.GetDisabledExtensions()
	if len(got) != 2 {
		t.Fatalf("GetDisabledExtensions() = %v, want 2 entries", got)
	}

	if err := set.SetExtensionEnabled("pencil", true); err != nil {
		t.Fatalf("SetExtensionEnabled(pencil, true) error = %v", err)
	}
	got = set.GetDisabledExtensions()
	if len(got) != 1 || got[0] != "laser" {
		t.Errorf("GetDisabledExtensions() = %v, want [laser]", got)
	}
}

func TestSetExtensionEnabled_IdempotentDisable(t *testing.T) {
	set := newExtensionsHarness(t)
	if err := set.SetExtensionEnabled("pencil", false); err != nil {
		t.Fatalf("SetExtensionEnabled error = %v", err)
	}
	if err := set.SetExtensionEnabled("pencil", false); err != nil {
		t.Fatalf("SetExtensionEnabled (second disable) error = %v", err)
	}
	got := set.GetDisabledExtensions()
	if len(got) != 1 || got[0] != "pencil" {
		t.Errorf("GetDisabledExtensions() = %v, want exactly one [pencil] entry, not a duplicate", got)
	}
}

func TestSetExtensionEnabled_SurvivesAcrossServiceInstances(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	trig := triggersvc.NewTriggerService(comp, slog.Default(), store)
	first := NewSettingsService(store, trig, false)
	if err := first.SetExtensionEnabled("pencil", false); err != nil {
		t.Fatalf("SetExtensionEnabled error = %v", err)
	}

	second := NewSettingsService(store, trig, false)
	got := second.GetDisabledExtensions()
	if len(got) != 1 || got[0] != "pencil" {
		t.Errorf("a fresh SettingsService over the same store: GetDisabledExtensions() = %v, want [pencil]", got)
	}
}

func TestSetExtensionEnabled_EmitsDataEvent(t *testing.T) {
	set := newExtensionsHarness(t)
	var gotEntity, gotID string
	prev := dataevent.TestHook
	dataevent.TestHook = func(entity, id string) { gotEntity, gotID = entity, id }
	defer func() { dataevent.TestHook = prev }()

	if err := set.SetExtensionEnabled("pencil", false); err != nil {
		t.Fatalf("SetExtensionEnabled error = %v", err)
	}
	if gotEntity != "extension" || gotID != "pencil" {
		t.Errorf("dataevent.Emit(%q, %q), want (\"extension\", \"pencil\")", gotEntity, gotID)
	}
}
