package settingssvc

import (
	"errors"
	"log/slog"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
	"github.com/alicoding/mill/internal/services/triggersvc"
)

// go test never runs against a live application.New() (see
// settingsservice_menu_test.go), and the notify adapter's cgo send
// aborts in a headless test process -- so NotifyPendingApproval's full
// away branch is not callable here. This covers the nil-window guard
// only (same reasoning as settingsservice_approvalprompt_test.go); the
// real dock bounce is OS-bound and manual-only
// (.claude/rules/testing.md).

func TestDockBounceFn_NilWindow_DoesNotPanic(t *testing.T) {
	dockBounceFn(nil)
}

func newAttentionHarness(t *testing.T) *SettingsService {
	t.Helper()
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	trig := triggersvc.NewTriggerService(comp, slog.Default(), store)
	return NewSettingsService(store, trig, false)
}

// withIdleTime swaps idleTimeFn for the duration of one test -- the
// same package-var seam dockBounceFn already uses, applied here so
// IsAway's idle branch is testable without this machine's real HID
// idle counter.
func withIdleTime(t *testing.T, d time.Duration, err error) {
	t.Helper()
	orig := idleTimeFn
	idleTimeFn = func() (time.Duration, error) { return d, err }
	t.Cleanup(func() { idleTimeFn = orig })
}

// TestIsAway_FocusedButIdle_ReturnsTrue pins goal 0023's original bug
// (docs/goals/0171-notification-spine.md's acceptance): a focused
// window sitting idle past the threshold must still count as away, not
// just an unfocused one.
func TestIsAway_FocusedButIdle_ReturnsTrue(t *testing.T) {
	s := newAttentionHarness(t)
	withIdleTime(t, 301*time.Second, nil) // threshold defaults to 300s
	if !s.IsAway(true) {
		t.Error("IsAway(focused=true) with idle >= threshold = false, want true (focused-but-idle counts as away)")
	}
}

func TestIsAway_FocusedAndActive_ReturnsFalse(t *testing.T) {
	s := newAttentionHarness(t)
	withIdleTime(t, 5*time.Second, nil)
	if s.IsAway(true) {
		t.Error("IsAway(focused=true) with idle well under threshold = true, want false (present)")
	}
}

func TestIsAway_Unfocused_ReturnsTrueRegardlessOfIdle(t *testing.T) {
	s := newAttentionHarness(t)
	withIdleTime(t, 0, nil)
	if !s.IsAway(false) {
		t.Error("IsAway(focused=false) = false, want true (unfocused is always away)")
	}
}

func TestIsAway_IdleReadError_FailsTowardAway(t *testing.T) {
	s := newAttentionHarness(t)
	withIdleTime(t, 0, errors.New("idletime: simulated read failure"))
	if !s.IsAway(true) {
		t.Error("IsAway(focused=true) with an idletime read error = false, want true (fail-safe toward away)")
	}
}
