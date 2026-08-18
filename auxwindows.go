package main

import "github.com/wailsapp/wails/v3/pkg/application"

// The ADR-0033 second-window family: always-alive auxiliary windows
// created once at startup, Hidden, shown/hidden for the app's life
// (never destroyed/recreated). Split from main.go along that family
// seam (the 500-line convention); main.go keeps the main window, tray,
// and service wiring.

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
