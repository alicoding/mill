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
}

// WrapWindow adapts a live *application.WebviewWindow -- called only
// from the root main package (main.go, auxwindows.go), the one place
// outside this package depguard allows to construct a real window.
func WrapWindow(w *application.WebviewWindow) *Window {
	return &Window{w: w}
}

func (win *Window) Show()                     { win.w.Show() }
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
