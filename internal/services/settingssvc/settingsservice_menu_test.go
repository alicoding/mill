package settingssvc

import (
	"log/slog"
	"testing"

	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
	"github.com/alicoding/mill/internal/services/triggersvc"
)

// go test never runs against a live application.New() (no native
// Cocoa run loop / menu bar in headless CI, same reasoning
// docs/SPEC.md §1.3 already states for HotkeyService/clipboard) --
// application.Get() is nil in every case below, so these only cover
// the reference-counting logic and the nil-app no-op guard, not an
// actual native accelerator strip/restore. That's the honest ceiling
// for automated coverage here; the real strip/restore only happens
// against a running desktop app (.claude/skills/run-mill, manual).

func newTestSettingsService(t *testing.T) *SettingsService {
	t.Helper()
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	trig := triggersvc.NewTriggerService(comp, slog.Default(), store)
	return NewSettingsService(store, trig, false)
}

func TestSuspendRestoreMenuAccelerators_NoLiveApp_DoesNotPanic(t *testing.T) {
	set := newTestSettingsService(t)

	set.SuspendMenuAccelerators()
	set.RestoreMenuAccelerators()

	if set.menuSuspendCount != 0 {
		t.Errorf("menuSuspendCount = %d, want 0 after a balanced suspend/restore", set.menuSuspendCount)
	}
}

// TestSuspendMenuAccelerators_ReferenceCounted covers the case three
// independent recorders (canvas Inspector, a Workflows-row inline
// capture, the Settings summon recorder) can each be mid-recording at
// once: the menu must stay logically suspended until every one of them
// has called Restore, not just the first or the last.
func TestSuspendMenuAccelerators_ReferenceCounted(t *testing.T) {
	set := newTestSettingsService(t)

	set.SuspendMenuAccelerators()
	set.SuspendMenuAccelerators()
	set.SuspendMenuAccelerators()
	if set.menuSuspendCount != 3 {
		t.Fatalf("menuSuspendCount = %d, want 3 after three Suspend calls", set.menuSuspendCount)
	}

	set.RestoreMenuAccelerators()
	if set.menuSuspendCount != 2 {
		t.Fatalf("menuSuspendCount = %d, want 2 after one Restore of three", set.menuSuspendCount)
	}

	set.RestoreMenuAccelerators()
	set.RestoreMenuAccelerators()
	if set.menuSuspendCount != 0 {
		t.Fatalf("menuSuspendCount = %d, want 0 once every Suspend has a matching Restore", set.menuSuspendCount)
	}
}

// TestRestoreMenuAccelerators_NeverGoesNegative covers a redundant
// Restore -- e.g. an unmount cleanup firing after a recording already
// finished normally (Escape/success both already called Restore once)
// -- which must be a safe no-op, never underflow the counter and leave
// a later, unrelated Suspend permanently unbalanced.
func TestRestoreMenuAccelerators_NeverGoesNegative(t *testing.T) {
	set := newTestSettingsService(t)

	set.RestoreMenuAccelerators()
	set.RestoreMenuAccelerators()
	if set.menuSuspendCount != 0 {
		t.Fatalf("menuSuspendCount = %d, want 0 -- Restore must floor at zero", set.menuSuspendCount)
	}

	// A real Suspend afterward must still count from a clean zero, not
	// from some negative value a buggy floor would have left behind.
	set.SuspendMenuAccelerators()
	if set.menuSuspendCount != 1 {
		t.Fatalf("menuSuspendCount = %d, want 1", set.menuSuspendCount)
	}
	set.RestoreMenuAccelerators()
}

// TestReleaseMenuAccelerators_NoLiveApp_DoesNotPanic covers the same
// no-live-app ceiling as TestSuspendRestoreMenuAccelerators_NoLiveApp_DoesNotPanic
// above -- application.Get() is nil in every test run (no native Cocoa
// run loop in headless CI), so this only proves the nil-app guard,
// never a real accelerator release. The real release only happens
// against a running desktop app (.claude/skills/run-mill, manual).
func TestReleaseMenuAccelerators_NoLiveApp_DoesNotPanic(t *testing.T) {
	set := newTestSettingsService(t)

	set.ReleaseMenuAccelerators()
}
