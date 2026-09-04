package windowing

import (
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// Window wraps a single *application.WebviewWindow -- the port every
// service package uses instead of holding the toolkit type directly
// (mainthread.go's package doc has the full boundary reasoning).
// WebviewWindow's own Show/Hide/Restore/Focus already marshal onto the
// main thread internally (confirmed against the pinned SDK source,
// unlike the App-level calls in app_actions.go), so these methods call
// straight through with no extra dispatch.
type Window struct {
	w *application.WebviewWindow
	// auxiliary marks a window in ADR-0033's second-window family, the
	// ones kept out of macOS window restoration -- see WrapAuxWindow.
	auxiliary bool
}

// WrapWindow adapts a live *application.WebviewWindow -- called only
// from the root main package (main.go, auxwindows.go), the one place
// outside this package depguard allows to construct a real window.
func WrapWindow(w *application.WebviewWindow) *Window {
	return &Window{w: w}
}

// WrapAuxWindow adapts an auxiliary window -- ADR-0033's second-window
// family (the Quick Panel, the approval prompt, the run monitor, the
// capture window, the tray panel) -- and keeps it out of macOS window
// restoration. AppKit re-opens every restorable window that was on
// screen when the process ended, so a relaunch could put four floating
// windows on screen at once (docs/goals/0344); a panel that survives a
// relaunch is the pattern no desktop app follows. The main window is
// wrapped with WrapWindow instead and stays restorable.
//
// The native NSWindow does not exist until Wails runs the window
// (NativeWindow() is nil until then), so the flag is applied at three
// points, each idempotent and each a no-op without a handle: here, on
// every native show, and on this port's own Show(). What matters is
// only that it lands before the next quit, since that is when AppKit
// records state -- and a window never shown was never on screen for
// AppKit to record.
func WrapAuxWindow(w *application.WebviewWindow) *Window {
	win := &Window{w: w, auxiliary: true}
	// Registering before the native window exists is safe: the darwin
	// backend replays every registered listener when it runs the
	// window (confirmed against the pinned SDK source,
	// webview_window_darwin.go's (*macosWebviewWindow).run).
	w.OnWindowEvent(events.Common.WindowShow, func(*application.WindowEvent) {
		win.markNonRestorable()
	})
	win.markNonRestorable()
	return win
}

// markNonRestorable applies the non-restorable flag to the wrapped
// window's live native handle. Reading the handle needs no marshal (it
// is a pointer field read), the AppKit call does -- so only the call
// is dispatched, through this package's one dispatch point.
func (win *Window) markNonRestorable() {
	if !win.auxiliary {
		return
	}
	handle := win.w.NativeWindow()
	if handle == nil {
		return
	}
	runMainThreadAction("windowing.Window.markNonRestorable", func() {
		setNonRestorableFn(handle)
	})
}

// setNonRestorableFn is markNonRestorable's seam to the real AppKit
// call -- a package var so a headless test can observe whether the
// guards above decided to reach the native layer at all.
var setNonRestorableFn = setNativeNonRestorable

// Show orders the window in. For an auxiliary window this is also the
// point where the native handle is guaranteed to exist (Wails runs a
// pending window on the way), so the non-restorable flag is re-applied
// here rather than depending on a native show notification alone.
func (win *Window) Show() {
	win.w.Show()
	win.markNonRestorable()
}

func (win *Window) Hide()                     { win.w.Hide() }
func (win *Window) Restore()                  { win.w.Restore() }
func (win *Window) Focus()                    { win.w.Focus() }
func (win *Window) Flash(enabled bool)        { win.w.Flash(enabled) }
func (win *Window) IsVisible() bool           { return win.w.IsVisible() }
func (win *Window) IsFocused() bool           { return win.w.IsFocused() }
func (win *Window) IsMaximised() bool         { return win.w.IsMaximised() }
func (win *Window) Position() (x, y int)      { return win.w.Position() }
func (win *Window) Size() (width, height int) { return win.w.Size() }

// OnLostFocus registers fn against WindowLostFocus -- ordering a key
// window out resigns its key status on the way, so this fires for
// every native dismiss path (Escape, an explicit Hide() call, focus
// moving elsewhere) uniformly.
func (win *Window) OnLostFocus(fn func()) {
	win.w.OnWindowEvent(events.Common.WindowLostFocus, func(*application.WindowEvent) { fn() })
}

// OnGeometryChange registers fn against every window event that means
// "position, size, or maximized state changed" -- the caller decides
// what "changed" means (debouncing, persisting); this only decides
// which native events count. Deliberately excludes fullscreen -- see
// the caller's own doc comment for why.
func (win *Window) OnGeometryChange(fn func()) {
	handler := func(*application.WindowEvent) { fn() }
	for _, evt := range []events.WindowEventType{
		events.Common.WindowDidMove,
		events.Common.WindowDidResize,
		events.Common.WindowMaximise,
		events.Common.WindowUnMaximise,
		events.Common.WindowRestore,
	} {
		win.w.OnWindowEvent(evt, handler)
	}
}

// FileDropEvent is a native OS file-drop delivered to a
// data-file-drop-target element -- real absolute paths, not an HTML5
// drag payload.
type FileDropEvent struct {
	Filenames  []string
	X, Y       int
	Attributes map[string]string
}

// OnFilesDropped registers fn against WindowFilesDropped -- a no-op
// callback invocation when the native event carries zero files (the
// drop landed outside any drop target).
func (win *Window) OnFilesDropped(fn func(FileDropEvent)) {
	win.w.OnWindowEvent(events.Common.WindowFilesDropped, func(e *application.WindowEvent) {
		ctx := e.Context()
		filenames := ctx.DroppedFiles()
		if len(filenames) == 0 {
			return
		}
		payload := FileDropEvent{Filenames: filenames}
		if details := ctx.DropTargetDetails(); details != nil {
			payload.X, payload.Y = details.X, details.Y
			payload.Attributes = details.Attributes
		}
		fn(payload)
	})
}
