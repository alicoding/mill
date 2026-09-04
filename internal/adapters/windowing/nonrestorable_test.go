package windowing

import (
	"testing"
	"unsafe"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// markNonRestorable reaches AppKit only for an auxiliary window that
// has a live native handle. A window Wails has not run yet reports a
// nil handle, and touching AppKit with one would be a crash rather
// than a no-op (docs/goals/0344).
func TestMarkNonRestorable_SkipsAWindowWithNoNativeHandle(t *testing.T) {
	calls := 0
	restoreSeam(t, func(unsafe.Pointer) { calls++ })

	win := &Window{w: &application.WebviewWindow{}, auxiliary: true}
	win.markNonRestorable()

	if calls != 0 {
		t.Fatalf("reached AppKit %d times with no native window; want 0", calls)
	}
}

// The main window stays restorable: only windows wrapped as auxiliary
// ever opt out.
func TestMarkNonRestorable_SkipsANonAuxiliaryWindow(t *testing.T) {
	calls := 0
	restoreSeam(t, func(unsafe.Pointer) { calls++ })

	win := WrapWindow(&application.WebviewWindow{})
	if win.auxiliary {
		t.Fatal("WrapWindow produced an auxiliary window; the main window must stay restorable")
	}
	win.markNonRestorable()

	if calls != 0 {
		t.Fatalf("reached AppKit %d times for the main window; want 0", calls)
	}
}

func restoreSeam(t *testing.T, fn func(unsafe.Pointer)) {
	t.Helper()
	prev := setNonRestorableFn
	setNonRestorableFn = fn
	t.Cleanup(func() { setNonRestorableFn = prev })
}
