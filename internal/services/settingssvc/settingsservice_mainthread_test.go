package settingssvc

import (
	"sync/atomic"
	"testing"
)

// P0 crash fix: application.App-level Show/Hide (as opposed to a
// *WebviewWindow's own Show/Hide) perform raw cgo calls with no
// main-thread marshal of their own, so every call reaching them must go
// through mainThreadRun (settingsservice_panel.go's doc comment has the
// full reasoning). These tests cover the seam itself, headless; the
// real crash (SIGTRAP pressing the summon hotkey) is OS-bound and
// covered by the manual-only registry (.claude/rules/testing.md).

func TestMainThreadRun_DefaultsToDirectCall(t *testing.T) {
	s := newTestSettingsService(t)
	called := false
	s.runOnMainThread(func() { called = true })
	if !called {
		t.Fatal("default mainThreadRun must call fn synchronously, headless tests never set a real runner")
	}
}

func TestSetMainThreadRunner_Overrides(t *testing.T) {
	s := newTestSettingsService(t)
	var invoked bool
	s.SetMainThreadRunner(func(fn func()) {
		invoked = true
		fn()
	})
	ran := false
	s.runOnMainThread(func() { ran = true })
	if !invoked {
		t.Error("overridden runner was never invoked")
	}
	if !ran {
		t.Error("overridden runner must still call fn through")
	}
}

func TestSetMainThreadRunner_NilLeavesDefaultInPlace(t *testing.T) {
	s := newTestSettingsService(t)
	s.SetMainThreadRunner(nil)
	called := false
	s.runOnMainThread(func() { called = true })
	if !called {
		t.Fatal("a nil SetMainThreadRunner call must not clear the direct-call default")
	}
}

// TestSummonKeydownLoop_RoutesThroughMainThreadSeam proves the hotkey
// callback path itself, not just runOnMainThread in isolation: a fake
// keydown fired on the events channel bindSummon hands to
// summonKeydownLoop must reach the injected runner before toggle runs.
func TestSummonKeydownLoop_RoutesThroughMainThreadSeam(t *testing.T) {
	var runCalls, toggleCalls int32
	run := func(fn func()) {
		atomic.AddInt32(&runCalls, 1)
		fn()
	}
	toggle := func() { atomic.AddInt32(&toggleCalls, 1) }

	events := make(chan struct{})
	done := make(chan struct{})
	go func() {
		summonKeydownLoop(events, run, toggle)
		close(done)
	}()

	events <- struct{}{} // fake keydown
	close(events)
	<-done

	if got := atomic.LoadInt32(&runCalls); got != 1 {
		t.Errorf("mainThreadRun seam invoked %d times, want 1", got)
	}
	if got := atomic.LoadInt32(&toggleCalls); got != 1 {
		t.Errorf("toggle invoked %d times, want 1", got)
	}
}
