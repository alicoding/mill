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
