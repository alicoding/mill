package windowing

import (
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// TestMacAppOptions_TerminatesOnlyOnExplicitQuit pins the invariant that
// two separate defects have now violated (goal 0188): Mill must never
// terminate as a side effect of a window becoming invisible.
//
// ApplicationShouldTerminateAfterLastWindowClosed true hands that
// decision to AppKit, which then kills the process the moment nothing
// is on screen -- silently, with exit code 0 and no crash report. Any
// path that hides the last window (the summon guard, a window-closing
// accelerator) becomes an app-killer the moment this flips.
func TestMacAppOptions_TerminatesOnlyOnExplicitQuit(t *testing.T) {
	if got := MacAppOptions().ApplicationShouldTerminateAfterLastWindowClosed; got {
		t.Errorf("ApplicationShouldTerminateAfterLastWindowClosed = %v, want false: "+
			"true lets AppKit kill Mill whenever the last window is hidden, "+
			"stopping the scheduler, triggers and watches with no user intent", got)
	}
}

// TestMacAppOptions_RegularArchetype pins the other half of the
// declaration. Regular keeps the Dock icon and the ⌘-Tab entry, which
// the main window needs as a primary working surface; Accessory would
// remove both. Wails also gates its own activate-ignoring-other-apps
// call on this value, so changing it silently changes focus behaviour.
func TestMacAppOptions_RegularArchetype(t *testing.T) {
	if got := MacAppOptions().ActivationPolicy; got != application.ActivationPolicyRegular {
		t.Errorf("ActivationPolicy = %v, want ActivationPolicyRegular", got)
	}
}
