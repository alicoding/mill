package windowing

import "testing"

// TestAvailable_NoLiveApp_FalseUnderTest pins the headless-test default
// every migrated call site relied on before moving here: `go test`
// never calls application.New(), so Available() must read false and
// every degrade-to-no-op path (Emit, OpenURL, ShowApp, ...) must take
// the safe branch instead of touching a nil app.
func TestAvailable_NoLiveApp_FalseUnderTest(t *testing.T) {
	if Available() {
		t.Fatal("expected Available() to be false with no live application under go test")
	}
}

// TestRunMainThreadAction_NoLiveApp_SkipsWithoutInvokingFn pins that a
// headless run never calls fn -- application.InvokeSync is unsafe to
// call before application.New() (it dispatches through a global app
// pointer this process never set), so runMainThreadAction must not
// reach it.
func TestRunMainThreadAction_NoLiveApp_SkipsWithoutInvokingFn(t *testing.T) {
	called := false
	runMainThreadAction("windowing.Test", func() { called = true })
	if called {
		t.Fatal("expected runMainThreadAction to skip fn with no live app")
	}
}

// TestEmit_NoLiveApp_NoPanic pins that every no-op-degrading function
// tolerates a nil app without panicking -- the same guard every call
// site this package replaced already carried.
func TestEmit_NoLiveApp_NoPanic(t *testing.T) {
	Emit("windowing-test-event", map[string]string{"k": "v"})
}

// TestQuit_NoLiveApp_NoPanic mirrors TestEmit_NoLiveApp_NoPanic for Quit.
func TestQuit_NoLiveApp_NoPanic(t *testing.T) {
	Quit()
}

// TestShowAppHideApp_NoLiveApp_NoPanic mirrors the above for the two
// App-level actions that DO route through runMainThreadAction.
func TestShowAppHideApp_NoLiveApp_NoPanic(t *testing.T) {
	ShowApp()
	HideApp()
}
