package settingssvc

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/alicoding/mill/internal/adapters/windowing"
)

// The leave handshake (goal 0295 S2): before the process goes -- or,
// in explicit save mode, before the main window hides -- Go asks the
// page to settle every live edit and waits for its answer.
//
// Wire protocol, page half in app/useBeforeQuitFlush.ts:
//
//	Go  -> page  mill-before-quit {reason: quit|restart|close}
//	page -> Go   mill-flushed <bool>      proceed (true) or cancel (false)
//	page -> Go   mill-quit-held           a Save all / Discard / Cancel
//	                                      sheet is up; the final
//	                                      mill-flushed comes when the
//	                                      user chooses
//
// The first answer is bounded (flushBound) so a hung page never holds
// the process; once the page reports held, the wait is effectively
// unbounded -- a visible sheet IS the user holding the quit.
//
// Every quit path lands on ONE gate, application.Options.ShouldQuit
// (main.go): app.Quit (the tray menu's Quit, QuitApp), the app menu's
// ⌘Q and the Dock's Quit all reach AppKit's applicationShouldTerminate,
// which consults it. ShouldQuit runs on the main thread inside that
// delegate call and must not block (the page's answer is delivered on
// that same thread), so it cancels the terminate, runs the handshake
// off-thread and re-quits with approval once the page has answered.
const (
	flushBound = 2 * time.Second
	heldBound  = 24 * time.Hour
)

const (
	leaveReasonQuit    = "quit"
	leaveReasonRestart = "restart"
	leaveReasonClose   = "close"
)

// leaveTransport is the page-event seam the handshake talks through
// -- the windowing adapter in the app, a fake in tests (the held /
// cancel / timeout branches need a page that answers on cue).
type leaveTransport interface {
	Emit(name string, payload any)
	WaitForAnyEvent(timeout time.Duration, names ...string) (string, any, bool)
}

type windowingTransport struct{}

func (windowingTransport) Emit(name string, payload any) { windowing.Emit(name, payload) }
func (windowingTransport) WaitForAnyEvent(timeout time.Duration, names ...string) (string, any, bool) {
	return windowing.WaitForAnyEvent(timeout, names...)
}

// leaveEvents is swapped by tests only.
var leaveEvents leaveTransport = windowingTransport{}

// leaveGate is the quit gate's state: approved short-circuits
// ShouldQuit once the handshake has said yes; inFlight collapses a
// second quit request while the sheet is up into a re-prompt.
type leaveGate struct {
	mu       sync.Mutex
	approved bool
	inFlight bool
}

// ShouldQuit is the toolkit's termination gate (application.Options.
// ShouldQuit). Returns true only once the handshake has approved;
// otherwise it starts (or re-prompts) the handshake and cancels this
// terminate -- the handshake calls windowing.Quit again on approval.
//
//wails:ignore
func (s *SettingsService) ShouldQuit() bool {
	s.leave.mu.Lock()
	approved := s.leave.approved
	s.leave.mu.Unlock()
	if approved {
		return true
	}
	go func() {
		if s.confirmLeaveOnce(leaveReasonQuit) {
			windowing.Quit()
		}
	}()
	return false
}

// confirmLeaveOnce runs the handshake through the gate: an already
// approved leave says yes at once; a handshake already in flight is
// re-prompted (the page re-shows or re-answers) and this caller
// yields; otherwise the handshake runs and its verdict is recorded.
func (s *SettingsService) confirmLeaveOnce(reason string) bool {
	s.leave.mu.Lock()
	if s.leave.approved {
		s.leave.mu.Unlock()
		return true
	}
	if s.leave.inFlight {
		s.leave.mu.Unlock()
		leaveEvents.Emit("mill-before-quit", map[string]string{"reason": reason})
		return false
	}
	s.leave.inFlight = true
	s.leave.mu.Unlock()
	ok := s.confirmLeave(reason)
	s.leave.mu.Lock()
	s.leave.inFlight = false
	s.leave.approved = ok
	s.leave.mu.Unlock()
	return ok
}

// revokeLeave clears an approval whose leave then failed (a restart
// the updater refused), so the next quit asks again.
func (s *SettingsService) revokeLeave() {
	s.leave.mu.Lock()
	s.leave.approved = false
	s.leave.mu.Unlock()
}

// confirmLeave is the handshake itself: emit the request, wait for
// the answer or the bound. Proceeds on timeout or with no live app --
// a page that never answers must not hold the process, and one that
// answered has already saved or chosen.
func (s *SettingsService) confirmLeave(reason string) bool {
	type answer struct {
		name string
		data any
		ok   bool
	}
	first := make(chan answer, 1)
	// Subscribe before emitting so a fast answer cannot be missed.
	go func() {
		name, data, ok := leaveEvents.WaitForAnyEvent(flushBound, "mill-flushed", "mill-quit-held")
		first <- answer{name, data, ok}
	}()
	// Give the subscriber a moment to attach before the request goes out.
	time.Sleep(10 * time.Millisecond)
	leaveEvents.Emit("mill-before-quit", map[string]string{"reason": reason})
	a := <-first
	if !a.ok {
		return true
	}
	if a.name == "mill-quit-held" {
		// The sheet lives in the main window's page; a quit asked from
		// the tray while that window is hidden must bring it back.
		if reason != leaveReasonClose {
			s.ShowWindow()
		}
		_, data, ok := leaveEvents.WaitForAnyEvent(heldBound, "mill-flushed")
		if !ok {
			return true
		}
		a.data = data
	}
	proceed, isBool := a.data.(bool)
	return !isBool || proceed
}

// HideMainWindowGuarded is the main window's close-means-hide (goal
// 0276) with explicit mode's guard in front of it: in automatic mode a
// hide is not a quit and nothing is asked; in explicit mode the page's
// unsaved edits hold the hide behind the same sheet quit uses. Runs
// from the WindowClosing hook on the main thread, so the guarded path
// is dispatched off it.
//
//wails:ignore
func (s *SettingsService) HideMainWindowGuarded() {
	s.mu.Lock()
	w := s.window
	s.mu.Unlock()
	if w == nil {
		return
	}
	if s.GetSaveMode() != SaveModeExplicit {
		w.Hide()
		return
	}
	go func() {
		if s.confirmLeave(leaveReasonClose) {
			w.Hide()
		}
	}()
}

// RestartApp relaunches into the update DownloadAndInstallUpdate just
// staged.
func (s *SettingsService) RestartApp() error {
	// Live edits first (goal 0295 S2), even when the restart itself is
	// unavailable: the flush is what a user counts on. A cancelled
	// leave is not an error -- the user chose to stay.
	if !s.confirmLeaveOnce(leaveReasonRestart) {
		return nil
	}
	s.mu.Lock()
	u := s.updater
	s.mu.Unlock()
	if u == nil {
		s.revokeLeave()
		return fmt.Errorf("updater not configured")
	}
	if err := u.Restart(context.Background()); err != nil {
		s.revokeLeave()
		return err
	}
	return nil
}
