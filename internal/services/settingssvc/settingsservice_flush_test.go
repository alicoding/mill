package settingssvc

import (
	"testing"
	"time"
)

// Headless (no live app) the handshake has nobody to ask and proceeds
// at once -- the property every quit path relies on: the gate never
// holds the process without a page to hold it.
func TestShouldQuit_CancelsFirstThenApprovesOnceTheHandshakeRan(t *testing.T) {
	set := newDensityHarness(t)
	if set.ShouldQuit() {
		t.Fatal("first ShouldQuit() = true, want false (the handshake runs off-thread first)")
	}
	deadline := time.Now().Add(3 * time.Second)
	for !set.ShouldQuit() {
		if time.Now().After(deadline) {
			t.Fatal("ShouldQuit() never approved after the headless handshake")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// A leave the updater then refuses must not leave a stale approval
// behind -- the next quit has to ask the page again.
func TestRestartApp_RefusedRestartRevokesTheApproval(t *testing.T) {
	set := newDensityHarness(t)
	if err := set.RestartApp(); err == nil {
		t.Fatal("RestartApp() with no updater = nil error, want an error")
	}
	set.leave.mu.Lock()
	approved := set.leave.approved
	set.leave.mu.Unlock()
	if approved {
		t.Error("leave.approved = true after a refused restart, want false")
	}
}

func TestSaveMode_DefaultsToAutomaticAndRoundTrips(t *testing.T) {
	set := newDensityHarness(t)
	if got := set.GetSaveMode(); got != SaveModeAutomatic {
		t.Errorf("GetSaveMode(unset) = %q, want %q", got, SaveModeAutomatic)
	}
	if err := set.SetSaveMode(SaveModeExplicit); err != nil {
		t.Fatalf("SetSaveMode(explicit) error = %v", err)
	}
	if got := set.GetSaveMode(); got != SaveModeExplicit {
		t.Errorf("GetSaveMode() = %q, want %q", got, SaveModeExplicit)
	}
	if err := set.SetSaveMode("whenever"); err == nil {
		t.Error("SetSaveMode(whenever) = nil error, want a rejection")
	}
}

// A leave already in flight (the sheet is up) is re-prompted, never
// run twice; an approved one answers yes without asking again.
func TestConfirmLeaveOnce_RepromptsInFlightAndShortCircuitsApproved(t *testing.T) {
	set := newDensityHarness(t)
	set.leave.mu.Lock()
	set.leave.inFlight = true
	set.leave.mu.Unlock()
	if set.confirmLeaveOnce(leaveReasonQuit) {
		t.Error("confirmLeaveOnce() while in flight = true, want false (re-prompt only)")
	}
	set.leave.mu.Lock()
	set.leave.inFlight = false
	set.leave.approved = true
	set.leave.mu.Unlock()
	if !set.confirmLeaveOnce(leaveReasonRestart) {
		t.Error("confirmLeaveOnce() once approved = false, want true")
	}
	set.revokeLeave()
	set.leave.mu.Lock()
	approved := set.leave.approved
	set.leave.mu.Unlock()
	if approved {
		t.Error("revokeLeave() left approved = true")
	}
}

// With no main window there is nothing to hide, in either mode.
func TestHideMainWindowGuarded_NoWindowIsANoop(t *testing.T) {
	set := newDensityHarness(t)
	set.HideMainWindowGuarded()
	if err := set.SetSaveMode(SaveModeExplicit); err != nil {
		t.Fatal(err)
	}
	set.HideMainWindowGuarded()
}

// QuitApp headless: the handshake proceeds and the (absent) app is
// asked to quit -- a no-op, never a panic.
func TestQuitApp_HeadlessProceeds(t *testing.T) {
	set := newDensityHarness(t)
	set.QuitApp()
	set.leave.mu.Lock()
	approved := set.leave.approved
	set.leave.mu.Unlock()
	if !approved {
		t.Error("QuitApp() headless did not approve the leave")
	}
}
