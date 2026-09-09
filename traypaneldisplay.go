package main

import (
	"github.com/alicoding/mill/internal/adapters/windowing"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// trayPanelOffset mirrors auxwindows.go's AttachWindow(trayPanel).
// WindowOffset(6) literal -- the gap trayPanelPosition preserves when
// it recomputes Y on the clicked display.
const trayPanelOffset = 6

// wireTrayPanelDisplay corrects the tray panel's screen after Wails'
// own AttachWindow positioning (goal 0417): systemtray_darwin.m:270
// positions the panel from the status item's carrier NSWindow's OWN
// `.screen`, which AppKit keeps pinned to the primary/focused display
// regardless of which display's menu-bar mirror was actually clicked --
// never the display under the cursor.
//
// events.Common.WindowShow is the earliest Wails window event that
// fires after SystemTray.processClick's PositionWindow call and no
// later than visibility, on this pinned SDK (systemtray.go:157-174:
// PositionWindow runs, THEN Show().Focus()). On darwin, WindowShow is
// emitted ONLY from windowDidChangeOcclusionState
// (webview_window_darwin.m:580-585); the tray panel's own custom
// windowShow:/windowHide: methods (:952-957) are never wired to an
// NSNotificationCenter observer or NSWindowDelegate selector, so they
// never fire. RegisterHook (not OnWindowEvent) runs synchronously
// within HandleWindowEvent ahead of any per-listener goroutine
// dispatch (webview_window.go's HandleWindowEvent runs hooks inline,
// then spawns one `go` per listener) -- WrapAuxWindow's own
// markNonRestorable is wired via OnWindowEvent on this same event, so
// this hook lands first. Wails' PositionWindow already ran by the time
// any Show-tied event fires, so a wrong position here is at most a
// one-frame flash, never the final position (goal 0417 decision 3).
func wireTrayPanelDisplay(app *application.App, trayPanel *application.WebviewWindow) {
	trayPanel.RegisterHook(events.Common.WindowShow, func(*application.WindowEvent) {
		repositionTrayPanel(app, trayPanel)
	})
}

// repositionTrayPanel reads the screen under the cursor and moves the
// already-shown tray panel there when it differs from the screen Wails
// placed it on.
func repositionTrayPanel(app *application.App, trayPanel *application.WebviewWindow) {
	cursorID, ok := windowing.CursorDisplayID()
	if !ok {
		return
	}
	target := app.Screen.GetByID(cursorID)
	if target == nil {
		return
	}
	placedX, placedY := trayPanel.Position()
	placedOn := screenContaining(app, placedX, placedY)
	if placedOn == nil {
		// GetPrimary() itself can be nil before Wails' first
		// processAndCacheScreens (screen_darwin.go:292's own getPrimaryScreen
		// checks this) -- clampedPanelPosition guards the same call the
		// same way.
		return
	}
	w, _ := trayPanel.Size()
	x, y, moved := trayPanelPosition(placedX, placedY, w, placedOn, target, trayPanelOffset)
	if !moved {
		return
	}
	trayPanel.SetPosition(x, y)
}

// screenContaining returns the screen whose Bounds contains (x, y),
// falling back to the primary screen -- Wails' own PositionWindow
// leaves the panel positioned on whichever screen it read from the
// status item's carrier window (systemtray_darwin.m:270), and
// app.Screen has no direct "screen of this point" accessor beyond
// ScreenNearestDipPoint, which returns nearest rather than containing
// and is not exposed on *application.App's Screen field in this
// pinned SDK's public surface.
func screenContaining(app *application.App, x, y int) *application.Screen {
	for _, screen := range app.Screen.GetAll() {
		b := screen.Bounds
		if x >= b.X && x < b.X+b.Width && y >= b.Y && y < b.Y+b.Height {
			return screen
		}
	}
	return app.Screen.GetPrimary()
}

// trayPanelPosition translates the tray panel's Wails-placed position
// (placedX, placedY, on placedOn) to the equivalent right-edge-anchored
// position on target (goal 0417 decision 2): every menu-bar extra sits
// the same distance from ITS OWN screen's right edge, so the distance
// from placedOn's right edge is the value that carries over, not the
// absolute X. Y always resets to target's own WorkArea top plus offset,
// since a menu bar is a fixed height on every display. x is clamped
// into target's Bounds so a wide offset on a narrower target can never
// push the panel off-screen. moved=false is an identity return
// (placedX, placedY unchanged) when target and placedOn are already
// the same display -- the caller does nothing with it, but a genuine
// no-op here means SetPosition is never even considered on the common
// single-display path.
func trayPanelPosition(placedX, placedY, w int, placedOn, target *application.Screen, offset int) (x, y int, moved bool) {
	if target.ID == placedOn.ID {
		return placedX, placedY, false
	}
	rightOffset := placedOn.Bounds.X + placedOn.Bounds.Width - (placedX + w)
	x = target.Bounds.X + target.Bounds.Width - rightOffset - w
	if x < target.Bounds.X {
		x = target.Bounds.X
	}
	if maxX := target.Bounds.X + target.Bounds.Width - w; x > maxX {
		x = maxX
	}
	y = target.WorkArea.Y + offset
	return x, y, true
}
