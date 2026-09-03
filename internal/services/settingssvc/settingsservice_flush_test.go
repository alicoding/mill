package settingssvc

import (
	"sync"
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

// scriptedPage answers the handshake on cue: each WaitForAnyEvent call
// pops the next scripted answer (name, payload, ok).
type scriptedPage struct {
	mu      sync.Mutex
	answers []struct {
		name string
		data any
		ok   bool
	}
	emitted []string
}

func (p *scriptedPage) Emit(name string, _ any) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.emitted = append(p.emitted, name)
}

func (p *scriptedPage) WaitForAnyEvent(_ time.Duration, _ ...string) (string, any, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if len(p.answers) == 0 {
		return "", nil, false
	}
	a := p.answers[0]
	p.answers = p.answers[1:]
	return a.name, a.data, a.ok
}

func swapLeaveTransport(t *testing.T, page *scriptedPage) {
	t.Helper()
	prev := leaveEvents
	leaveEvents = page
	t.Cleanup(func() { leaveEvents = prev })
}

// The page's answers decide: a flushed=true proceeds, a held sheet
// whose final answer is false cancels, a held sheet that then says
// yes proceeds, and a page that never answers is not waited for.
func TestConfirmLeave_FollowsThePagesAnswer(t *testing.T) {
	type ans = struct {
		name string
		data any
		ok   bool
	}
	cases := []struct {
		name    string
		answers []ans
		want    bool
	}{
		{"flushed at once", []ans{{"mill-flushed", true, true}}, true},
		{"held then cancelled", []ans{{"mill-quit-held", true, true}, {"mill-flushed", false, true}}, false},
		{"held then saved", []ans{{"mill-quit-held", true, true}, {"mill-flushed", true, true}}, true},
		{"held then the page vanished", []ans{{"mill-quit-held", true, true}, {"", nil, false}}, true},
		{"never answered", nil, true},
		{"odd payload proceeds", []ans{{"mill-flushed", "yes", true}}, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			set := newDensityHarness(t)
			page := &scriptedPage{}
			page.answers = append(page.answers, c.answers...)
			swapLeaveTransport(t, page)
			if got := set.confirmLeave(leaveReasonQuit); got != c.want {
				t.Errorf("confirmLeave() = %v, want %v", got, c.want)
			}
			if len(page.emitted) == 0 || page.emitted[0] != "mill-before-quit" {
				t.Errorf("emitted %v, want mill-before-quit first", page.emitted)
			}
		})
	}
}

// RestartApp through the gate: a cancelled leave returns nil without
// touching the updater and leaves nothing approved.
func TestRestartApp_CancelledLeaveIsNotAnError(t *testing.T) {
	set := newDensityHarness(t)
	page := &scriptedPage{}
	page.answers = append(page.answers, struct {
		name string
		data any
		ok   bool
	}{"mill-flushed", false, true})
	swapLeaveTransport(t, page)
	if err := set.RestartApp(); err != nil {
		t.Errorf("RestartApp() after Cancel = %v, want nil", err)
	}
	set.leave.mu.Lock()
	approved := set.leave.approved
	set.leave.mu.Unlock()
	if approved {
		t.Error("a cancelled leave left approved = true")
	}
}
