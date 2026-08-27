// Package main embeds the built frontend, sets up the window/tray, and
// constructs + wires every bounded-context service. No domain logic
// lives here (.claude/rules/backend.md).
package main

import (
	"embed"

	"log"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"github.com/alicoding/mill/internal/adapters/credential"
	"github.com/alicoding/mill/internal/adapters/launchatlogin"
	"github.com/alicoding/mill/internal/adapters/settings"
	"github.com/alicoding/mill/internal/adapters/windowing"
	"github.com/alicoding/mill/internal/services/agentloopsvc"
	"github.com/alicoding/mill/internal/services/atlassvc"
	"github.com/alicoding/mill/internal/services/backupsvc"
	"github.com/alicoding/mill/internal/services/capabilitysvc"
	"github.com/alicoding/mill/internal/services/clipboardhistorysvc"
	"github.com/alicoding/mill/internal/services/codeloopsvc"
	"github.com/alicoding/mill/internal/services/companionsvc"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/configuresvc"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/docssvc"
	"github.com/alicoding/mill/internal/services/executionsvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/mcpsvc"
	"github.com/alicoding/mill/internal/services/notificationsvc"
	"github.com/alicoding/mill/internal/services/settingssvc"
	"github.com/alicoding/mill/internal/services/triggersvc"
	"github.com/alicoding/mill/internal/services/wiring"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// millChannel/millVersion/millUpdateVersion are the build-stamp trio
// release.yml (channel=release) and ci.yml's beta job (channel=beta)
// override via ldflags -X; every other build keeps the defaults below.
// millChannel gates settingssvc's install-and-restart path. millVersion
// feeds run receipts/the backup manifest/the release updater's
// CurrentVersion, and must agree with the git tag and build/config.yml
// (release.yml's verify step enforces this) -- a beta build never
// touches it. millUpdateVersion is what the updater compares the beta
// feed's rolling tag against and AppVersion shows in Settings: a SemVer
// prerelease compares strictly below its release, so a beta tag against
// the bare "0.5.0" would never register as newer -- a beta build stamps
// a per-build identifier here instead (`-X main.millUpdateVersion=0.5.0-beta.<run>`).
var millChannel = "source"

const millVersion = "0.5.0"

var millUpdateVersion = millVersion

// Wails uses Go's `embed` package to embed the frontend files into the binary.
// Any files in the frontend/dist folder will be embedded into the binary and
// made available to the frontend.
// See https://pkg.go.dev/embed for more information.

//go:embed all:frontend/dist
var assets embed.FS

// The in-app Docs surface's content (goal 0125 phase 1): the same
// userdocs tree the repository publishes and llms.txt indexes,
// embedded so docs ship inside the binary like the frontend does.
//
//go:embed all:userdocs
var userdocsFS embed.FS

//go:embed build/appicon.png
var trayIconPNG []byte

func init() {
	// Each RegisterEvent[T] gives the binding generator a typed JS/TS API.
	application.RegisterEvent[string]("time")
	application.RegisterEvent[triggersvc.HotkeyActivity]("hotkey-activity")
	application.RegisterEvent[mcpsvc.MCPWriteRequest]("mcp-write-approval")
	application.RegisterEvent[mcpsvc.MCPWriteActivity]("mcp-write-activity")
	application.RegisterEvent[dataevent.Changed](dataevent.EventName)
	application.RegisterEvent[atlassvc.MirrorChanged](atlassvc.MirrorChangedEvent)
	application.RegisterEvent[executionsvc.GuardrailPendingChanged]("guardrail-pending-changed")
	application.RegisterEvent[companionsvc.CompanionDelta](companionsvc.DeltaEventName)
	application.RegisterEvent[agentloopsvc.AgentLoopEvent](agentloopsvc.StateEventName)
	application.RegisterEvent[agentloopsvc.AgentLoopDelta](agentloopsvc.DeltaEventName)
	// docs/adr/0033: OpenMainWindow emits this so App.tsx can switch views
	// once the main window is back in front -- broadcast to every window.
	application.RegisterEvent[string]("mill-navigate")
}

// main initializes the application, creates the window, and wires every
// bounded-context service together.
func main() {

	// Create a new Wails application by providing the necessary options.
	// Variables 'Name' and 'Description' are for application metadata.
	// 'Assets' configures the asset server with the 'FS' variable pointing to the frontend files.
	// 'Bind' is a list of Go struct instances. The frontend has access to the methods of these instances.
	// 'Mac' options tailor the application when running an macOS.
	// Reuses Wails3's own default logger (colorized to stderr in dev mode via isatty detection, silently discarded in
	// production builds — see application.DefaultLogger's per-build-tag implementations) instead of wiring up a second,
	// parallel slog handler. Passed to both Mill's own services and application.Options.Logger so app-level events (a
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
	// docs/goals/0171-notification-spine.md: needs only settingsStore.
	notificationService := notificationsvc.New(settingsStore)

	compositionService := compositionsvc.NewCompositionService(settingsStore)
	triggerService := triggersvc.NewTriggerService(compositionService, logger, settingsStore)
	compositionService.SetSyncer(triggerService)
	// MILL_TEST_KEYRING=memory swaps the OS keychain for a process-
	// local store (e2e servers only): Linux CI has no Secret Service,
	// so real-keychain semantics -- including "credential absent" --
	// are otherwise untestable in server mode.
	credentialStore := credential.New()
	if os.Getenv("MILL_TEST_KEYRING") == "memory" {
		credentialStore = credential.NewInMemory()
	}
	configureService := configuresvc.NewConfigureService(settingsStore, compositionService, credentialStore)
	// MILL_SECRETS_PATH overrides for e2e isolation, same convention as MILL_SETTINGS_PATH above (WireSecrets' own doc comment covers the rest of what this wires).
	secretService := wiring.WireSecrets(windowing.ConfigDirOrEnv("MILL_SECRETS_PATH", "secrets.kdbx"), credentialStore, configureService)
	wiring.WireSecretRedaction(secretService) // goal 0185 S4
	// docs/adr/0038: Atlas's storage/CRUD layer (cross-surface wiring
	// arrives below via injected seams, never direct imports).
	atlasService := atlassvc.NewAtlasService(settingsStore)
	// docs/goals/0101 slice 1: the companion's own AI-provider lookup
	// resolves through composition.ResolveAIProvider, which reads the
	// SAME package-level seam configureService wires just below (no
	// separate wiring call needed here).
	companionService := companionsvc.NewCompanionService(atlasService)

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
		executionDatabaseURL = "sqlite:" + windowing.ConfigDirOrEnv("MILL_EXECUTION_DB_PATH", "execution.db")
	}

	// MILL_BACKUP_DIR follows the same override convention as above;
	// docs/goals/0065's backupService construction reuses this value.
	backupDir := windowing.ConfigDirOrEnv("MILL_BACKUP_DIR", "backups")
	backupsvc.GuardVersionChange(logger, settingsStore, backupsvc.SQLiteDBPath(executionDatabaseURL), settingsPath, backupDir, millVersion)

	mcpAuditService := wiring.WireAuditTrails(secretService, backupsvc.SQLiteDBPath(executionDatabaseURL), logger)

	// goal 0234: composition and secretsvc's own audit store are wired
	// together in wiring.WireClipboardHistory below, once secretService's
	// OpenAudit call (mcpAuditService's own construction, above) has run.
	clipboardHistoryService := clipboardhistorysvc.NewClipboardHistoryService(settingsStore)
	wiring.WireClipboardHistory(clipboardHistoryService, secretService)

	guardrailService := guardrailsvc.NewGuardrailService(settingsStore, compositionService)
	// docs/goals/0240 S1: the coding loop's Confirm-screen preview --
	// read-only over guardrailService.Rules(), no dependency on
	// ExecutionService (the actual run/approve/cancel path reuses
	// ExecutionService's own RPCs directly, never a bespoke exec path).
	codeLoopService := codeloopsvc.NewCodeLoopService(guardrailService)
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
	// docs/adr/0035's system-event dispatch seam, plus the notification
	// spine's second consumer of it (docs/goals/0171-notification-spine.md).
	wiring.WireSystemEventNotifications(executionService, triggerService, notificationService)
	// goal 0052 slice 3: the version a run receipt's Build field stamps.
	executionService.SetVersion(millVersion)

	// docs/adr/0038 decision 4, goal 0061 slice C: "Update now" runs a
	// card's referenced workflow through the normal guardrail-gated
	// path -- same late-bound-setter shape as WireChildWorkflowRunner
	// above, atlassvc never imports executionsvc directly. Kind is
	// RunKindTriggered (production semantics: a disabled or
	// never-published refresh workflow is rejected, same requirement
	// child-workflow nodes already hold their callable target to).
	atlassvc.SetWorkflowRunner(func(workflowID string) (string, bool, bool, error) {
		summary, err := executionService.RunWorkflow(workflowID, executionsvc.RunKindTriggered, nil)
		if err != nil {
			return "", false, false, err
		}
		pending := summary.Pending != nil
		return summary.RunID, !pending && summary.Status == "SUCCESS", pending, nil
	})
	// Card actions (goal 0084): source-card-recording entry, so the cycle guard covers action runs.
	atlassvc.SetCardActionRunner(func(workflowID, sourceCardID string, values map[string]string, payload string) error {
		_, err := executionService.RunWorkflowForAtlasCard(workflowID, sourceCardID, values, payload)
		return err
	})
	executionService.SetRunCompletionSink(atlasService.NotifyRunCompleted)
	atlasService.WireCompositionSeams(triggerService.DispatchAtlasCardChange) // goal 0066
	// Cross-service seam adapters (recognition, List projection) live in the wiring package -- composition-root code split out of this file at the 500-line limit.
	wiring.WireAtlasProjections(atlasService, configureService, compositionService)
	wiring.WireValidationSeams(configureService)
	wiring.WirePasteConversion(atlasService, configureService)
	wiring.WireNotify()

	backupService := backupsvc.Wire(backupsvc.SQLiteDBPath(executionDatabaseURL), settingsPath, backupDir, millVersion, compositionService, configureService, atlasService)

	// docs/adr/0038, goal 0063/0067: the share model's mirror root, plus the image tool's captures folder (goal 0169 slice 2).
	wiring.WireAtlasStorageDirs(atlasService)
	atlasService.SetGuardedDataPaths(settingsPath, backupsvc.SQLiteDBPath(executionDatabaseURL), backupDir)

	remoteAuthService := wiring.WireRemoteAuth(settingsStore, logger) // docs/goals/0132-remote-access.md SLICE 1

	settingsService := settingssvc.NewSettingsService(settingsStore, triggerService, settingsPath != defaultSettingsPath)
	wiring.WireNotificationChannels(settingsService, notificationService) // docs/goals/0171-notification-spine.md
	wiring.WirePhoneChannel(remoteAuthService, notificationService)       // docs/goals/0132-remote-access.md SLICE B
	wiring.WireUpdateEvents(settingsService, triggerService)
	settingsService.SetAppVersion(millUpdateVersion)
	// The user's persisted channel opt-in wins over the build stamp --
	// a source-built copy can deliberately follow the beta feed
	// (Settings > Updates). Resolved once here so the guard, label,
	// and provider feed below all agree for this run.
	effectiveChannel := settingsService.ResolveUpdateChannel(millChannel)
	settingsService.SetUpdateChannel(effectiveChannel)
	// goal 0100: DownloadAndInstallUpdate's pre-swap snapshot seam.
	settingsService.SetBackupRunner(backupService.BackupRunner())
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
	// workflows/Configure data as read-only Resources. Bind-address
	// precedence (settingssvc.ResolveMCPAddr): the MILL_MCP_ADDR env
	// ALWAYS wins (a deploy/env-level override, same MILL_* convention
	// as settingsPath/executionDatabaseURL above), then the Settings >
	// MCP access address, then the loopback default -- never 0.0.0.0
	// unless explicitly chosen, since this is a new, unauthenticated
	// local listener and staying loopback-bound is the conservative
	// default until a real access-control need is named. A bind failure
	// is logged, not fatal -- this is additive local tooling, not
	// something the rest of the app depends on to function.
	millMCPAddr, _ := settingssvc.ResolveMCPAddr(os.Getenv("MILL_MCP_ADDR"), settingsService.MCPAccessAddress())
	millMCPService := mcpsvc.NewMillMCPService(millVersion, compositionService, configureService, settingsStore, userdocsFS, mcpAuditService.ServerMiddleware())
	settingsService.SetMCPService(millMCPService)
	millMCPService.SetExecutionService(executionService)
	millMCPService.SetAtlasService(atlasService)
	millMCPService.SetAuditResolver(mcpAuditService.ResolveParkedWrite)
	if err := millMCPService.Start(millMCPAddr); err != nil {
		logger.Error("mill MCP server", "error", err)
	} else {
		logger.Info("mill MCP server listening", "addr", millMCPAddr)
	}

	agentLoopService := agentloopsvc.NewAgentLoopService(millMCPService) // an MCP client of it, ADR-0035

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
			application.NewService(secretService),
			application.NewService(atlasService),
			application.NewService(companionService),
			application.NewService(agentLoopService),
			application.NewService(guardrailService),
			application.NewService(clipboardHistoryService),
			application.NewService(codeLoopService),
			application.NewService(executionService),
			application.NewService(settingsService),
			application.NewService(backupService),
			application.NewService(docssvc.New(userdocsFS)),
			application.NewService(mcpAuditService),
			application.NewService(remoteAuthService),
			application.NewService(notificationService),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
			// Armed only for a server build (wiring.AssetMiddleware).
			Middleware: wiring.AssetMiddleware(remoteAuthService),
		},
		// Mill's macOS archetype and its termination contract live in the
		// windowing adapter, where they are documented and pinned by a test
		// (goal 0188) rather than sitting as bare option values here.
		Mac: windowing.MacAppOptions(),
		// Production-only single-instance guard (docs/SPEC.md §3.7's
		// data-corruption hazard). nil in dev/server builds -- see
		// singleinstance_{production,dev}.go for why the guard must NOT
		// be active under `wails3 dev`. getMainWindow closes over
		// mainWindow, assigned below after the window is created (the
		// callback only ever fires on a real second launch, long after).
		SingleInstance: singleInstanceOptions(func() *application.WebviewWindow { return mainWindow }),
	})

	// Wails3's own first-party self-updater (v3/pkg/updater) -- app.Updater
	// is constructed by application.New() itself; the provider/Init
	// wiring is extracted to settingssvc.InitUpdater (keeps this file
	// under its own line-count convention). A construction failure here
	// is logged, not fatal -- a broken updater must never block the app
	// from starting.
	if err := settingssvc.InitUpdater(app.Updater, "alicoding/mill", settingssvc.ResolveUpdateCurrentVersion(effectiveChannel, millUpdateVersion), effectiveChannel, settingsService); err != nil {
		logger.Error("updater init", "error", err)
	}
	// Opt-in daily background check (goal 0122) -- a no-op unless the
	// user enabled it in Settings; applies at boot like the channel
	// preference.
	settingsService.StartAutoUpdateChecks()

	// Global hotkey registration needs the native run loop already
	// spinning (docs/SPEC.md §2.2) -- ServiceStartup runs before the
	// loop starts, so this waits for ApplicationStarted instead.
	// TriggerService.Sync also registers the non-hotkey trigger types
	// from here, for one uniform startup path.
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
		// notification half. A failure here (a bare dev binary with no
		// real bundle ID, or server mode) is logged, never fatal.
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
		// Explicit name so tooling addressing windows by name (the MCP
		// bridge's `window` parameter, internal/webviewbridgesmoke) can
		// target the main window deterministically instead of relying on
		// Wails's auto-generated "window-N" fallback.
		Name:   "main",
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
		// EnableFileDrop turns on Wails3's own native OS drag-and-drop:
		// real absolute paths, delivered only to elements carrying
		// data-file-drop-target (AtlasBoard.tsx, AtlasCardOverlay.tsx).
		// In-app HTML5 drag (the creation tray, React Flow node drag) is
		// unaffected -- the runtime only intercepts a 'Files' MIME type.
		EnableFileDrop: true,
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
	settingsService.SetWindow(windowing.WrapWindow(mainWindow))
	settingsService.WatchWindowGeometry()
	atlasService.WireFileDropWindow(windowing.WrapWindow(mainWindow))
	launchatlogin.SetAutostartManager(app.Autostart)

	// ADR-0033 second-window family, built in auxwindows.go.
	settingsService.SetPanelWindow(windowing.WrapWindow(newQuickPanelWindow(app)))
	settingsService.SetApprovalPromptWindow(windowing.WrapWindow(newApprovalPromptWindow(app)))

	// docs/SPEC.md §3.7 (task #8): a persistent tray icon as Mill's own
	// running-indicator (windowing.MacAppOptions keeps Mill alive after
	// the last window closes, goal 0188). Clicking it and "Show Mill"
	// both reach ShowWindow (settingsservice_presence.go); Quit calls
	// windowing.Quit(), the one termination call Mill's own code makes.
	trayIcon := app.SystemTray.New()
	trayIcon.SetIcon(trayIconPNG)
	trayIcon.SetTooltip("Mill")
	trayIcon.OnClick(func() { settingsService.ShowWindow() })
	trayMenu := app.NewMenu()
	trayMenu.Add("Show Mill").OnClick(func(*application.Context) { settingsService.ShowWindow() })
	trayMenu.AddSeparator()
	trayMenu.Add("Quit").OnClick(func(*application.Context) { windowing.Quit() })
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

	wiring.RunShutdown(logger, executionService, backupService, millMCPService, mcpAuditService, atlasService, secretService)

	// If an error occurred while running the application, log it and exit.
	if err != nil {
		log.Fatal(err)
	}
}
