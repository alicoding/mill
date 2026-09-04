package settingssvc

import "testing"

// Regression: the menu-bar status panel was created by the tray and
// never registered with the service, so the hide that claims to cover
// every floating window missed it and the OS could bring it back after
// a relaunch (docs/goals/0344). The family is a single list now; this
// pins its membership so a new floating window has to join it.
func TestAuxWindowSlots_CoversEveryFloatingWindow(t *testing.T) {
	set := newDensityHarness(t)
	const wantSlots = 5 // panel, approval prompt, run monitor, capture, tray panel
	if got := len(set.auxWindowSlots()); got != wantSlots {
		t.Fatalf("aux window slots = %d, want %d", got, wantSlots)
	}
	for i, w := range set.auxWindowSlots() {
		if w != nil {
			t.Errorf("slot %d is wired in a headless test; want nil", i)
		}
	}
	// Hiding the whole family with nothing wired stays a no-op.
	set.HideAuxWindows()
}
