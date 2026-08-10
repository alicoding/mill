package settingssvc

import (
	"log/slog"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
	"github.com/alicoding/mill/internal/services/triggersvc"
)

// Both directions of docs/SPEC.md §3.7's bidirectional hotkey-conflict
// check, exercised via the same "seed state directly, assert rejection
// happens before any real OS hotkey.Bind call" pattern
// TestAssignHotkey_RejectsConflict (triggerservice_test.go) already
// established -- these can't call the real hotkey API headless either.

// TestShowWindow_NilWindow_DoesNotPanic covers the extraction this
// session pulled out of bindSummon's own inline goroutine (task #8) --
// ShowWindow is now called from two places (the summon hotkey and the
// tray icon's click handler), so its nil-window guard is worth its own
// test rather than only being implicitly covered by whichever caller
// happened to exercise it before.
func TestShowWindow_NilWindow_DoesNotPanic(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	trig := triggersvc.NewTriggerService(comp, slog.Default(), store)
	set := NewSettingsService(store, trig, false)

	set.ShowWindow() // SetWindow was never called -- must not panic.
}

// TestIsIsolatedData_ReflectsConstructorArg covers the frontend's
// "isolated test data" indicator's own backing signal (App.tsx) --
// main.go computes this from whether MILL_SETTINGS_PATH was set, this
// just proves the plumbing from constructor arg to the bound getter,
// which is the part unit-testable without exercising main() itself.
func TestIsIsolatedData_ReflectsConstructorArg(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	trig := triggersvc.NewTriggerService(comp, slog.Default(), store)

	if got := NewSettingsService(store, trig, false).IsIsolatedData(); got != false {
		t.Errorf("IsIsolatedData() = %v, want false", got)
	}
	if got := NewSettingsService(store, trig, true).IsIsolatedData(); got != true {
		t.Errorf("IsIsolatedData() = %v, want true", got)
	}
}

func TestAssignHotkey_RejectsSummonHotkeyConflict(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	trig := triggersvc.NewTriggerService(comp, slog.Default(), store)
	set := NewSettingsService(store, trig, false)

	// Seeded directly, not via AssignSummonHotkey (real OS call) --
	// ReservedCombo only reads s.summonHK, so this exercises the
	// rejection path in TriggerService.AssignHotkey without touching
	// real OS state.
	set.summonHK = triggersvc.PersistedHotkey{Mods: []string{"option", "shift"}, Key: "Space"}
	trig.SetReservedCombo(set.ReservedCombo)

	_, err := trig.AssignHotkey("some-workflow", []string{"option", "shift"}, "Space")
	if err == nil {
		t.Fatal("AssignHotkey() with a combo already claimed by the summon hotkey: want error, got nil")
	}
	if !strings.Contains(err.Error(), "summon") {
		t.Errorf("AssignHotkey() error = %q, want it to mention the summon hotkey", err.Error())
	}
}

func TestAssignSummonHotkey_RejectsWorkflowConflict(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)

	// Seeded via the persisted-bindings store key, not via AssignHotkey
	// (real OS call) -- AssignSummonHotkey checks trig.ClaimedCombos()
	// before ever calling hotkey.Bind, and ClaimedCombos reads what
	// loadPersistedHotkeys restored from the store.
	_ = store.Set(triggersvc.HotkeyBindingsKey, `{"load-sample-html-workflow":{"mods":["cmd","shift"],"key":"M"}}`)
	trig := triggersvc.NewTriggerService(comp, slog.Default(), store)
	set := NewSettingsService(store, trig, false)

	_, err := set.AssignSummonHotkey([]string{"cmd", "shift"}, "M")
	if err == nil {
		t.Fatal("AssignSummonHotkey() with a combo already claimed by a workflow: want error, got nil")
	}
	if !strings.Contains(err.Error(), "Load sample HTML") {
		t.Errorf("AssignSummonHotkey() error = %q, want it to name the conflicting workflow", err.Error())
	}
}

func TestSettingsService_GetSummonHotkey_EmptyWhenUnassigned(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	trig := triggersvc.NewTriggerService(comp, slog.Default(), store)
	set := NewSettingsService(store, trig, false)

	if got := set.GetSummonHotkey(); got != "" {
		t.Errorf("GetSummonHotkey() on a fresh service = %q, want empty", got)
	}
}

func TestSettingsService_PersistAndLoadSummonHotkey(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	trig := triggersvc.NewTriggerService(comp, slog.Default(), store)
	set := NewSettingsService(store, trig, false)

	set.summonHK = triggersvc.PersistedHotkey{Mods: []string{"option", "shift"}, Key: "Space"}
	set.persistSummonHotkey()

	reloaded := NewSettingsService(store, trig, false)
	if got := reloaded.GetSummonHotkey(); got == "" {
		t.Error("GetSummonHotkey() on a service constructed against a store with a persisted summon hotkey: want a non-empty binding, got empty")
	}
}

// Window geometry (docs/SPEC.md §3.7's Update) -- WatchWindowGeometry
// itself needs a real *application.WebviewWindow (no headless run loop
// in CI, same class of gap §1.3 already notes for HotkeyService's real
// OS binding); these tests cover the headless-testable pure-logic half:
// LoadWindowGeometry/persistWindowGeometry's persist/restore round trip
// and the off-screen guard.

func TestLoadWindowGeometry_NothingPersisted_ReturnsNotOK(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	trig := triggersvc.NewTriggerService(comp, slog.Default(), store)
	set := NewSettingsService(store, trig, false)

	if _, _, _, _, _, ok := set.LoadWindowGeometry(); ok {
		t.Error("LoadWindowGeometry() on a fresh service returned ok=true, want false")
	}
}

func TestPersistAndLoadWindowGeometry_RoundTrips(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	trig := triggersvc.NewTriggerService(comp, slog.Default(), store)
	set := NewSettingsService(store, trig, false)

	set.persistWindowGeometry(windowGeometry{X: 100, Y: 200, Width: 1200, Height: 800, Maximized: true})

	x, y, width, height, maximized, ok := set.LoadWindowGeometry()
	if !ok {
		t.Fatal("LoadWindowGeometry() after persisting valid geometry returned ok=false")
	}
	if x != 100 || y != 200 || width != 1200 || height != 800 || !maximized {
		t.Errorf("LoadWindowGeometry() = (%d, %d, %d, %d, %v), want (100, 200, 1200, 800, true)", x, y, width, height, maximized)
	}

	// Also confirmed via a second service instance over the same store --
	// a real persist/restore round trip, not just an in-memory read of
	// what was just written (same discipline
	// TestSettingsService_PersistAndLoadSummonHotkey already uses).
	reloaded := NewSettingsService(store, trig, false)
	if _, _, _, _, _, ok := reloaded.LoadWindowGeometry(); !ok {
		t.Error("LoadWindowGeometry() on a service reloaded from the same store returned ok=false, want true")
	}
}

func TestLoadWindowGeometry_OffScreenPosition_Rejected(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	trig := triggersvc.NewTriggerService(comp, slog.Default(), store)
	set := NewSettingsService(store, trig, false)

	// A position far enough off any real display to be almost certainly
	// a stale save from a monitor that's since been disconnected --
	// wailsapp/wails#2739's own documented limitation (no monitor-
	// identity API), guarded against rather than blindly reapplied.
	set.persistWindowGeometry(windowGeometry{X: 50000, Y: 50000, Width: 1000, Height: 618})

	if _, _, _, _, _, ok := set.LoadWindowGeometry(); ok {
		t.Error("LoadWindowGeometry() with an off-screen persisted position returned ok=true, want false (rejected by the off-screen guard)")
	}
}

func TestLoadWindowGeometry_ZeroSize_Rejected(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	trig := triggersvc.NewTriggerService(comp, slog.Default(), store)
	set := NewSettingsService(store, trig, false)

	set.persistWindowGeometry(windowGeometry{X: 0, Y: 0, Width: 0, Height: 0})

	if _, _, _, _, _, ok := set.LoadWindowGeometry(); ok {
		t.Error("LoadWindowGeometry() with zero width/height returned ok=true, want false")
	}
}
