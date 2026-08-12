package main

import (
	"context"
	"embed"

	"log"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"github.com/alicoding/mill/internal/adapters/credential"
	"github.com/alicoding/mill/internal/adapters/settings"
	"github.com/alicoding/mill/internal/services/capabilitysvc"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/configuresvc"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/executionsvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/mcpsvc"
	"github.com/alicoding/mill/internal/services/settingssvc"
	"github.com/alicoding/mill/internal/services/triggersvc"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
	"github.com/wailsapp/wails/v3/pkg/updater"
	updaterGithub "github.com/wailsapp/wails/v3/pkg/updater/providers/github"
)

// millVersion is the version CurrentVersion the updater compares
// releases against. No real tagged-release process exists yet
// (docs/SPEC.md §3.7's own note) -- this is a placeholder that keeps
// the mechanism wired and correct so a real release process has
// nothing left to build here, not a claim that auto-update is a
// finished, working pipeline today.
const millVersion = "0.1.0"

// Wails uses Go's `embed` package to embed the frontend files into the binary.
// Any files in the frontend/dist folder will be embedded into the binary and
// made available to the frontend.
// See https://pkg.go.dev/embed for more information.

//go:embed all:frontend/dist
var assets embed.FS

//go:embed build/appicon.png
var trayIconPNG []byte

func init() {
	// Register a custom event whose associated data type is string.
	// This is not required, but the binding generator will pick up registered events
	// and provide a strongly typed JS/TS API for them.
	application.RegisterEvent[string]("time")
	application.RegisterEvent[triggersvc.HotkeyActivity]("hotkey-activity")
	application.RegisterEvent[mcpsvc.MCPWriteRequest]("mcp-write-approval")
	application.RegisterEvent[mcpsvc.MCPWriteActivity]("mcp-write-activity")
	application.RegisterEvent[dataevent.Changed](dataevent.EventName)
	application.RegisterEvent[executionsvc.GuardrailPendingChanged]("guardrail-pending-changed")
	// docs/adr/0033: the Quick Panel's "Open Mill"/"Open Settings" rows
	// (OpenMainWindow) emit this so App.tsx can switch the store's view
	// once the main window is back in front -- broadcast to every open
	// window, same as every other event registered here.
	application.RegisterEvent[string]("mill-navigate")
}

// main function serves as the application's entry point. It initializes the application, creates a window,
// and starts a goroutine that emits a time-based event every second. It subsequently runs the application and
// logs any error that might occur.
func main() {

	// Create a new Wails application by providing the necessary options.
	// Variables 'Name' and 'Description' are for application metadata.
	// 'Assets' configures the asset server with the 'FS' variable pointing to the frontend files.
	// 'Bind' is a list of Go struct instances. The frontend has access to the methods of these instances.
	// 'Mac' options tailor the application when running an macOS.
	// Reuses Wails3's own default logger (colorized to stderr in dev mode
	// via isatty detection, silently discarded in production builds — see
	// application.DefaultLogger's per-build-tag implementations) instead of
	// wiring up a second, parallel slog handler. Passed to both Mill's own
	// services and application.Options.Logger so app-level events (a
	// hotkey firing) and Wails3's own system messages share one stream.
	logger := application.DefaultLogger(slog.LevelInfo)

	// application.Path resolves the OS-appropriate app-support directory
	// (~/Library/Application Support on macOS, verified directly against
	// its adrg/xdg backing) -- the same convention Alfred/Raycast/1Password
	// use for their own persisted settings, not something Mill invents.
	// MILL_SETTINGS_PATH overrides this -- needed because server-mode and
	// desktop-mode builds resolve to the exact same real path otherwise,
	// which would let the Playwright e2e suite (server mode) write real
	// composed workflows into the actual desktop dev app's saved state.
	// playwright.config.ts points this at a throwaway temp file.
	defaultSettingsPath := filepath.Join(application.Path(application.PathConfigHome), "mill", "settings.json")
	settingsPath := os.Getenv("MILL_SETTINGS_PATH")
	if settingsPath == "" {
		settingsPath = defaultSettingsPath
	}
	settingsStore, err := settings.New(settingsPath)
	if err != nil {
		log.Fatal(err)
	}

	compositionService := compositionsvc.NewCompositionService(settingsStore)
	triggerService := triggersvc.NewTriggerService(compositionService, logger, settingsStore)
	compositionService.SetSyncer(triggerService)
	configureService := configuresvc.NewConfigureService(settingsStore, compositionService, credential.New())

	// Separate SQLite file from settings.json (own schema, own lifecycle
	// -- durable-execution checkpoints, not app config) but the same
	// config-dir convention and the same MILL_* env-override shape
	// settingsPath already established above, for the identical reason:
	// desktop-mode and server-mode e2e runs must not share real state.
	//
	// MILL_EXECUTION_DATABASE_URL is a second, independent override: a
	// full DBOS-native DSN (e.g. a Postgres/CockroachDB URL a regulated
	// deployment points at its own audit database -- DBOS accepts this
	// natively, confirmed against dbos.Config's own doc comment, no
	// adapter change needed). Takes precedence over the path-based
	// override below when set; MILL_EXECUTION_DB_PATH and the default
	// sqlite path are otherwise unchanged.
	executionDatabaseURL := os.Getenv("MILL_EXECUTION_DATABASE_URL")
	if executionDatabaseURL == "" {
		executionDBPath := os.Getenv("MILL_EXECUTION_DB_PATH")
		if executionDBPath == "" {
			executionDBPath = filepath.Join(application.Path(application.PathConfigHome), "mill", "execution.db")
		}
		executionDatabaseURL = "sqlite:" + executionDBPath
	}
	guardrailService := guardrailsvc.NewGuardrailService(settingsStore, compositionService)
	executionService, err := executionsvc.NewExecutionService(executionDatabaseURL, compositionService, guardrailService)
	if err != nil {
		log.Fatal(err)
	}
	// Single execution path (docs/adr/0008): a headless trigger fire now
	// runs through the same durable ExecutionService.RunWorkflow every
	// other entrypoint uses, tagged RunKindTriggered -- constructed after
	// TriggerService (which needs comp at construction time for Sync's
	// own workflow lookups) since ExecutionService itself depends on
	// compositionService, so this can't be a constructor parameter
	// without a cycle; same late-bound-setter shape as SetReservedCombo
	// below.
	triggerService.SetExecutionService(executionService)
	// docs/adr/0010: a child-workflow node's real DBOS parent/child
	// invocation, wired the same late-bound way for the same reason.
	executionService.WireChildWorkflowRunner()
	// docs/adr/0035: the trigger-system-event dispatch seam --
	// ExecutionService (the producer) never imports triggersvc (the
	// consumer); this wires them together, same late-bound-setter shape
	// as every other injected-function seam here.
	executionService.SetSystemEventSink(triggerService.DispatchSystemEvent)

	settingsService := settingssvc.NewSettingsService(settingsStore, triggerService, settingsPath != defaultSettingsPath)
	// Bidirectional hotkey-conflict check (docs/SPEC.md §3.7): a
	// per-workflow hotkey can't silently collide with the app-level
	// summon hotkey, and vice versa -- SettingsService.AssignSummonHotkey
	// already checks triggerService.ClaimedCombos() directly; this wires
	// the other direction.
	triggerService.SetReservedCombo(settingsService.ReservedCombo)
	// docs/goals/0014-home-dashboard.md: Home's TimeSaved metric reads
	// each workflow's user-editable "minutes saved per run" estimate,
	// which SettingsService owns (its own persisted preference, §3.7) --
	// wired in only now since ExecutionService is constructed before
	// SettingsService exists, same late-bound-setter shape as
	// SetReservedCombo just above.
	executionService.SetMinutesSavedLookup(settingsService.GetWorkflowMinutesSaved)

	// docs/SPEC.md §11 (task #12): Mill as MCP server, exposing its own
	// workflows/Configure data as read-only Resources. MILL_MCP_ADDR
	// overrides the bind address, same MILL_* override convention as
	// settingsPath/executionDatabaseURL above -- default is loopback-only
	// (127.0.0.1), never 0.0.0.0, since this is a new, unauthenticated
	// local listener and staying loopback-bound is the conservative
	// default until a real access-control need is named. A bind failure
	// is logged, not fatal -- this is additive local tooling, not
	// something the rest of the app depends on to function.
	millMCPAddr := os.Getenv("MILL_MCP_ADDR")
	if millMCPAddr == "" {
		millMCPAddr = "127.0.0.1:8090"
	}
	millMCPService := mcpsvc.NewMillMCPService(millVersion, compositionService, configureService, settingsStore)
	settingsService.SetMCPService(millMCPService)
	millMCPService.SetExecutionService(executionService)
	if err := millMCPService.Start(millMCPAddr); err != nil {
		logger.Error("mill MCP server", "error", err)
	} else {
		logger.Info("mill MCP server listening", "addr", millMCPAddr)
	}

	// Declared before application.New so the SingleInstance callback's
	// closure (below) can capture it; assigned with `=` once the window
	// is actually created further down. The callback only fires on a real
	// second launch, long after mainWindow is set.
	var mainWindow *application.WebviewWindow

	app := application.New(application.Options{
		Name:        "mill",
		Description: "Guardrailed agentic-workflow automation",
		Logger:      logger,
		Services: []application.Service{
			application.NewService(&capabilitysvc.CapabilitiesService{}),
			application.NewService(compositionService),
			application.NewService(triggerService),
			application.NewService(configureService),
			application.NewService(guardrailService),
			application.NewService(executionService),
			application.NewService(settingsService),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
		// Production-only single-instance guard (docs/SPEC.md §3.7's
		// data-corruption hazard). nil in dev/server builds -- see
		// singleinstance_{production,dev}.go for why the guard must NOT
		// be active under `wails3 dev`. getMainWindow closes over
		// mainWindow, assigned below after the window is created (the
		// callback only ever fires on a real second launch, long after).
		SingleInstance: singleInstanceOptions(func() *application.WebviewWindow { return mainWindow }),
	})

	// Wails3's own first-party self-updater (v3/pkg/updater, confirmed
	// via docs/SPEC.md §3.7's research: no separate Sparkle integration
	// needed, this ships in the framework already). app.Updater is
	// constructed by application.New() itself; Init just needs a
	// provider. A GitHub-Releases-provider construction failure here
	// would only happen from a malformed static Config, not a network
	// call (New doesn't hit the network) -- logged, not fatal, since a
	// broken updater must never block the app from starting.
	if ghProvider, err := updaterGithub.New(updaterGithub.Config{Repository: "alicoding/mill"}); err != nil {
		logger.Error("updater provider init", "error", err)
	} else if err := app.Updater.Init(updater.Config{
		CurrentVersion: millVersion,
		Providers:      []updater.Provider{ghProvider},
	}); err != nil {
		logger.Error("updater init", "error", err)
	} else {
		settingsService.SetUpdater(app.Updater)
	}

	// Global hotkey registration needs the native run loop already
	// spinning (see docs/SPEC.md §2.2's note on this) -- doing this from
	// ServiceStartup, which runs before the run loop starts, would risk
	// the exact silent-registration-failure class already documented
	// there. ApplicationStarted fires once the loop is actually live.
	// TriggerService.Sync also registers the non-hotkey trigger types
	// (schedule/clipboard-watch/filesystem-watch) from here, even though
	// those don't need the run loop -- one uniform startup path is
	// simpler than special-casing which trigger types can register
	// earlier for a few hundred milliseconds' difference that matters to
	// nothing.
	app.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(*application.ApplicationEvent) {
		triggerService.Sync(compositionService.Workflows())
		settingsService.RestoreSummonHotkey()
		// docs/goals/0016-keymap-system.md: releases the native File >
		// Close (⌘W) menu accelerator so that keypress falls through to
		// the keymap's own command dispatch (tab.close) instead of being
		// intercepted by NSMenu first -- must run before any hotkey
		// recorder could ever call SuspendMenuAccelerators (see
		// ReleaseMenuAccelerators's own doc comment for why the ordering
		// matters). View > Reload (⌘R/⌘⇧R) is deliberately left alone --
		// workflow.run's default is ⌘↩, not ⌘R (owner decision: ⌘R stays
		// the native browser/dev reload).
		settingsService.ReleaseMenuAccelerators()
		// docs/adr/0032 §3: the away-user attention layer's OS-
		// notification half (Approve/Deny actions on a pending MCP
		// write, plain-click-to-focus on a guardrail park). Needs the
		// native app to actually exist first, same reason
		// RestoreSummonHotkey/ReleaseMenuAccelerators wait for this
		// event rather than running from ServiceStartup. A failure here
		// (a bare dev binary with no real bundle ID, or server mode) is
		// logged and never fatal -- this is additive attention tooling,
		// not something the rest of the app depends on.
		if err := settingsService.SetupAwayAttention(); err != nil {
			logger.Warn("away-attention notifications setup", "error", err)
		}
	})

	// Create a new window with the necessary options.
	// 'Title' is the title of the window.
	// 'Mac' options tailor the window when running on macOS.
	// 'BackgroundColour' is the background colour of the window.
	// 'URL' is the URL that will be loaded into the webview.
	//
	// Window sized to the golden ratio (1000 / 618 ≈ 1.618) by default --
	// overridden by the persisted geometry from a previous session, if
	// any (docs/SPEC.md §3.7's Update), applied here rather than moved
	// after creation since there's no "move it after creation" path that
	// avoids an initial flash at the default position/size.
	windowWidth, windowHeight := 1000, 618
	windowX, windowY := 0, 0
	windowStartState := application.WindowStateNormal
	hasPosition := false
	if x, y, w, h, maximized, ok := settingsService.LoadWindowGeometry(); ok {
		windowX, windowY, hasPosition = x, y, true
		windowWidth, windowHeight = w, h
		if maximized {
			windowStartState = application.WindowStateMaximised
		}
	}
	windowOptions := application.WebviewWindowOptions{
		Title:  "Mill",
		Width:  windowWidth,
		Height: windowHeight,
		// MinWidth/MinHeight are Wails3's own mechanism for "don't let the
		// window shrink small enough to break the layout" (see
		// docs/SPEC.md §2.2) -- not a custom guard. Floor chosen so the
		// UnderlineNav tabs, a Runbook card's action row, and the footer
		// all still fit without wrapping into each other.
		MinWidth:   640,
		MinHeight:  420,
		StartState: windowStartState,
		Mac: application.MacWindow{
			InvisibleTitleBarHeight: 50,
			Backdrop:                application.MacBackdropTranslucent,
			TitleBar:                application.MacTitleBarHiddenInset,
		},
		BackgroundColour: application.NewRGB(6, 7, 15),
		URL:              "/",
	}
	if hasPosition {
		windowOptions.X = windowX
		windowOptions.Y = windowY
		// InitialPosition defaults to WindowCentered (its zero value) --
		// X/Y are silently ignored unless this is explicitly set to
		// WindowXY, confirmed directly against the SDK source before
		// relying on it, not assumed.
		windowOptions.InitialPosition = application.WindowXY
	}
	mainWindow = app.Window.NewWithOptions(windowOptions)
	settingsService.SetWindow(mainWindow)
	settingsService.WatchWindowGeometry()

	// The Quick Panel (docs/adr/0033): a second, always-alive floating
	// window the summon hotkey toggles -- a Raycast/Alfred/1Password-
	// style quick-invoke surface, not the main window itself. Created
	// once at startup, Hidden, and shown/hidden for the rest of the
	// app's life (never destroyed/recreated) -- the same "second window,
	// same services/bindings" shape the beta.4 SDK's own examples/
	// spotlight demonstrates. URL is a hash route, not a bare path:
	// production asset serving has no SPA fallback, so a bare path
	// second window would 404 in a real installed build.
	//
	// Deliberately NOT ActivationPolicyAccessory (unlike the SDK's own
	// spotlight example) -- that's an app-wide policy that would pull
	// Mill's dock icon too, conflicting with §3.7's locked dock+tray
	// coexistence. Deliberately NOT attempting a non-activating NSPanel
	// either -- unmerged upstream at beta.4 (ADR-0033's research);
	// showing this window still activates Mill and steals focus, which
	// SettingsService's yieldFocusIfMainHidden mitigates on dismiss.
	panelWindow := app.Window.NewWithOptions(application.WebviewWindowOptions{
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
	settingsService.SetPanelWindow(panelWindow)

	// The floating approval prompt (docs/goals/0023-attention-escalation.md
	// item 1): the incoming-call/askpass pattern, ADR-0033's second-
	// window mechanism reused rather than re-derived -- always-alive,
	// Hidden, floating above every Space/full-screen app, hash-routed.
	// Shown by the BACKEND itself (SettingsService.NotifyPendingApproval's
	// away verdict), never by a hotkey. Deliberately NOT HideOnFocusLost
	// (unlike the Quick Panel above): a decision prompt must not vanish
	// just because focus wandered -- Escape (HideOnEscape) is its one
	// explicit, native dismiss path.
	approvalPromptWindow := app.Window.NewWithOptions(application.WebviewWindowOptions{
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
	settingsService.SetApprovalPromptWindow(approvalPromptWindow)

	// docs/SPEC.md §3.7 (task #8): a tray icon as a running-indicator --
	// closes a real gap run-mill's own SKILL.md already names ("no
	// automated path to verify a real desktop-only state"), and answers
	// "is Mill running" the same way Raycast/Alfred/1Password do (§3.7's
	// own research: a persistent menu-bar icon IS the running-indicator
	// pattern, not a separate status API). Coexists with the dock icon
	// deliberately -- the safer, reversible default named in this
	// session's own goal condition, not a "menu-bar-only app" redesign;
	// ApplicationShouldTerminateAfterLastWindowClosed stays true,
	// unchanged. Clicking it reuses ShowWindow (SettingsService), the
	// exact same show/restore/focus sequence the summon hotkey already
	// uses -- one behavior, two triggers, not a second copy of it.
	trayIcon := app.SystemTray.New()
	trayIcon.SetIcon(trayIconPNG)
	trayIcon.SetTooltip("Mill")
	trayIcon.OnClick(func() { settingsService.ShowWindow() })
	trayMenu := app.NewMenu()
	trayMenu.Add("Show Mill").OnClick(func(*application.Context) { settingsService.ShowWindow() })
	trayMenu.AddSeparator()
	trayMenu.Add("Quit").OnClick(func(*application.Context) { app.Quit() })
	trayIcon.SetMenu(trayMenu)

	// Create a goroutine that emits an event containing the current time every second.
	// The frontend can listen to this event and update the UI accordingly.
	go func() {
		for {
			now := time.Now().Format(time.RFC1123)
			app.Event.Emit("time", now)
			time.Sleep(time.Second)
		}
	}()

	// Run the application. This blocks until the application has been exited.
	err = app.Run()

	// Flush any in-flight step checkpoints before the process actually
	// exits -- best-effort (the app is already tearing down), logged
	// rather than fatal.
	if shutdownErr := executionService.Shutdown(5 * time.Second); shutdownErr != nil {
		logger.Error("execution runtime shutdown", "error", shutdownErr)
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	if shutdownErr := millMCPService.Shutdown(shutdownCtx); shutdownErr != nil {
		logger.Error("mill MCP server shutdown", "error", shutdownErr)
	}
	cancel()

	// If an error occurred while running the application, log it and exit.
	if err != nil {
		log.Fatal(err)
	}
}
