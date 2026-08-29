package main

import (
	"strconv"

	"github.com/alicoding/mill/internal/adapters/windowing"
	"github.com/alicoding/mill/internal/services/settingssvc"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// The ADR-0033 second-window family: always-alive auxiliary windows
// created once at startup, Hidden, shown/hidden for the app's life
// (never destroyed/recreated). Split from main.go along that family
// seam (the 500-line convention); main.go keeps the main window, tray,
// and service wiring.
//
// Hidden/HideOnFocusLost/HideOnEscape below are declarative AppKit
// options that fire with no Go code running (goal 0188 slice 2) -- the
// Go-side half of presence policy these windows share with the main
// window lives in internal/services/settingssvc/
// settingsservice_presence.go (showing) and settingsservice_panel.go's
// yieldFocusIfMainHidden (hiding).

// newQuickPanelWindow builds the Quick Panel (docs/adr/0033): a
// floating window the summon hotkey toggles. URL is a hash route, not
// a bare path: production asset serving has no SPA fallback, so a bare
// path second window would 404 in a real installed build. Deliberately
// NOT ActivationPolicyAccessory (would pull Mill's dock icon too) and
// NOT a non-activating NSPanel (unmerged upstream at beta.4) --
// showing this window still activates Mill and steals focus, which
// SettingsService's yieldFocusIfMainHidden mitigates on dismiss.
func newQuickPanelWindow(app *application.App) *application.WebviewWindow {
	return app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:             "quickpanel",
		Title:            "Mill Quick Panel",
		Width:            560,
		Height:           400,
		Hidden:           true,
		Frameless:        true,
		DisableResize:    true,
		InitialPosition:  application.WindowCentered,
		HideOnFocusLost:  true,
		HideOnEscape:     true,
		BackgroundColour: application.NewRGB(6, 7, 15),
		Mac: application.MacWindow{
			Backdrop:           application.MacBackdropTranslucent,
			WindowLevel:        application.MacWindowLevelFloating,
			CollectionBehavior: application.MacWindowCollectionBehaviorCanJoinAllSpaces | application.MacWindowCollectionBehaviorFullScreenAuxiliary,
			TitleBar: application.MacTitleBar{
				AppearsTransparent: true,
				Hide:               true,
			},
		},
		URL: "/#/quickpanel",
	})
}

// newApprovalPromptWindow builds the floating approval prompt
// (docs/goals/0023-attention-escalation.md item 1): the incoming-call/
// askpass pattern, ADR-0033's second-window mechanism reused rather
// than re-derived. Shown by the BACKEND itself
// (SettingsService.NotifyPendingApproval's away verdict), never by a
// hotkey. Deliberately NOT HideOnFocusLost (unlike the Quick Panel):
// a decision prompt must not vanish just because focus wandered --
// Escape (HideOnEscape) is its one explicit, native dismiss path.
func newApprovalPromptWindow(app *application.App) *application.WebviewWindow {
	return app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:             "approvalprompt",
		Title:            "Mill Approval",
		Width:            520,
		Height:           200,
		Hidden:           true,
		Frameless:        true,
		DisableResize:    true,
		InitialPosition:  application.WindowCentered,
		HideOnEscape:     true,
		BackgroundColour: application.NewRGB(6, 7, 15),
		Mac: application.MacWindow{
			Backdrop:           application.MacBackdropTranslucent,
			WindowLevel:        application.MacWindowLevelFloating,
			CollectionBehavior: application.MacWindowCollectionBehaviorCanJoinAllSpaces | application.MacWindowCollectionBehaviorFullScreenAuxiliary,
			TitleBar: application.MacTitleBar{
				AppearsTransparent: true,
				Hide:               true,
			},
		},
		URL: "/#/approvalprompt",
	})
}

// newTrayPanelWindow builds the menu-bar status panel (docs/goals/
// 0189): the Docker-Desktop-shaped surface the tray icon toggles via
// SystemTray.AttachWindow -- presence, pending human action, running
// work with Stop, and the honest quit contract. A DECLARED
// non-activating NSPanel (beta.12's MacWindowClassPanel +
// PanelPreferences), never hand-managed activation -- the
// hand-managed version is the seam that produced the 0182/0186/0188
// defect family, and a non-activating panel structurally cannot steal
// key status from the frontmost app. Its own window, deliberately NOT
// the Quick Panel's (a search-and-run surface with its own summon
// machinery); position comes from the tray's own screen-aware
// PositionWindow, so no InitialPosition here.
func newTrayPanelWindow(app *application.App) *application.WebviewWindow {
	return app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:             "traypanel",
		Title:            "Mill Status",
		Width:            340,
		Height:           440,
		Hidden:           true,
		Frameless:        true,
		DisableResize:    true,
		HideOnEscape:     true,
		HideOnFocusLost:  true,
		BackgroundColour: application.NewRGB(6, 7, 15),
		Mac: application.MacWindow{
			Backdrop:           application.MacBackdropTranslucent,
			WindowClass:        application.MacWindowClassPanel,
			PanelPreferences:   application.MacPanelPreferences{FloatingPanel: true, NonActivating: true, BecomesKeyOnlyIfNeeded: true},
			CollectionBehavior: application.MacWindowCollectionBehaviorCanJoinAllSpaces | application.MacWindowCollectionBehaviorFullScreenAuxiliary,
			TitleBar: application.MacTitleBar{
				AppearsTransparent: true,
				Hide:               true,
			},
		},
		URL: "/#/traypanel",
	})
}

// setupTray builds the menu-bar surface (docs/goals/0189) -- lives
// with the aux-window family since the attached status panel IS one
// of them, and main.go stays under the 500-line convention.
func setupTray(app *application.App, settingsService *settingssvc.SettingsService) {
	// docs/goals/0189: the menu bar is a SURFACE, not a launcher. The
	// icon's existence is presence (windowing.MacAppOptions keeps Mill
	// alive after the last window closes, goal 0188); left-click
	// toggles the attached status panel (Wails' own default click
	// handler once AttachWindow is set -- no OnClick override);
	// right-click keeps the native menu as the conventional escape
	// hatch. SetTemplateIcon (not SetIcon) so the icon adapts to the
	// menu bar's own appearance; SetLabel carries the pending-human-
	// action count, driven by the SAME frontend aggregate the dock
	// badge uses (SetPendingBadge's tray hook below -- one count, two
	// chromes). SetLabel is InvokeSync internally, safe from RPC
	// goroutines.
	trayIcon := app.SystemTray.New()
	trayIcon.SetTemplateIcon(trayIconPNG)
	trayIcon.SetTooltip("Mill")
	trayIcon.AttachWindow(newTrayPanelWindow(app)).WindowOffset(6)
	settingsService.SetTrayCount(func(count int) {
		if count > 0 {
			trayIcon.SetLabel(strconv.Itoa(count))
			return
		}
		trayIcon.SetLabel("")
	})
	trayMenu := app.NewMenu()
	trayMenu.Add("Open Mill").OnClick(func(*application.Context) { settingsService.ShowWindow() })
	trayMenu.AddSeparator()
	trayMenu.Add("Quit").OnClick(func(*application.Context) { windowing.Quit() })
	trayIcon.SetMenu(trayMenu)
}
