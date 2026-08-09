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

// HotkeyActivity is emitted once a triggered workflow resolves (success
// or failure) -- not just hotkey fires despite the name (kept for the
// event's own wire compatibility; renaming the event string itself would
// be a cosmetic-only churn no caller needs). The Go-side slog lines
// (triggerservice.go) log the same information for terminal/`task dev`
// visibility; this event is the in-app equivalent, so a headless
// trigger's outcome is visible without a terminal — added after a real
// hotkey worked correctly (fired, ran, wrote to the clipboard) but
// looked from the UI like nothing happened, because nothing in the UI
// ever said otherwise.
type HotkeyActivity struct {
	WorkflowID string `json:"workflowID"`
	Binding    string `json:"binding"`
	Success    bool   `json:"success"`
	Detail     string `json:"detail"`
	// Result is the actual output copied to the clipboard, so the UI can
	// show what a trigger fire actually produced, not just its byte count.
	// Empty on failure -- there's nothing successful to show.
	Result string `json:"result"`
}

func init() {
	// Register a custom event whose associated data type is string.
	// This is not required, but the binding generator will pick up registered events
	// and provide a strongly typed JS/TS API for them.
	application.RegisterEvent[string]("time")
	application.RegisterEvent[HotkeyActivity]("hotkey-activity")
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

	compositionService := NewCompositionService(settingsStore)
	triggerService := NewTriggerService(compositionService, logger, settingsStore)
	compositionService.SetSyncer(triggerService)
	configureService := NewConfigureService(settingsStore, compositionService, credential.New())

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
	executionService, err := NewExecutionService(executionDatabaseURL, compositionService)
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
	executionService.wireChildWorkflowRunner()

	settingsService := NewSettingsService(settingsStore, triggerService, settingsPath != defaultSettingsPath)
	// Bidirectional hotkey-conflict check (docs/SPEC.md §3.7): a
	// per-workflow hotkey can't silently collide with the app-level
	// summon hotkey, and vice versa -- SettingsService.AssignSummonHotkey
	// already checks triggerService.ClaimedCombos() directly; this wires
	// the other direction.
	triggerService.SetReservedCombo(settingsService.ReservedCombo)

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
	millMCPService := NewMillMCPService(compositionService, configureService)
	if err := millMCPService.Start(millMCPAddr); err != nil {
		logger.Error("mill MCP server", "error", err)
	} else {
		logger.Info("mill MCP server listening", "addr", millMCPAddr)
	}

	app := application.New(application.Options{
		Name:        "mill",
		Description: "Guardrailed agentic-workflow automation",
		Logger:      logger,
		Services: []application.Service{
			application.NewService(&SpecService{}),
			application.NewService(&CapabilitiesService{}),
			application.NewService(compositionService),
			application.NewService(triggerService),
			application.NewService(configureService),
			application.NewService(executionService),
			application.NewService(settingsService),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
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
	mainWindow := app.Window.NewWithOptions(windowOptions)
	settingsService.SetWindow(mainWindow)
	settingsService.WatchWindowGeometry()

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
