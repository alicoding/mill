// Package settingssvc is the Wails-facing layer over Mill's own
// app-level settings -- config that applies to Mill itself (launch at
// login, the summon hotkey, window geometry, build/update state)
// independent of any specific workflow, distinct from both Configure
// (node-kind authoring) and a Trigger's per-workflow config.
package settingssvc

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"sync"
	"time"

	"github.com/alicoding/mill/internal/adapters/hotkey"
	"github.com/alicoding/mill/internal/adapters/launchatlogin"
	"github.com/alicoding/mill/internal/adapters/settings"
	"github.com/alicoding/mill/internal/adapters/windowing"
	"github.com/alicoding/mill/internal/services/mcpsvc"
	"github.com/alicoding/mill/internal/services/notificationsvc"
	"github.com/alicoding/mill/internal/services/triggersvc"
	"github.com/wailsapp/wails/v3/pkg/updater"
)

// summonHotkeyKey persists the app-level summon hotkey's (mods, key)
// pair -- same one-atomic-JSON-blob-per-key shape as
// triggerHotkeyBindingsKey (triggerservice.go), sharing the same
// settings.json file rather than a second store/file.
const summonHotkeyKey = "settings-summon-hotkey"

// legacyForwardApprovalsEnabledKey is the settings key
// ForwardPendingApproval used to persist before docs/adr/0035's forward
// refactor deleted that private send path in favor of the seeded
// "Example: Forward pending approvals" workflow. Kept here, read-only,
// purely so a user who had the old toggle on gets a one-line startup
// notice instead of the feature silently vanishing -- never re-added as
// a real Get/Set RPC.
const legacyForwardApprovalsEnabledKey = "settings-forward-approvals-enabled"

// SettingsService is the Wails-facing layer over docs/SPEC.md §3.7's
// "global app settings" -- settings that apply to Mill itself,
// independent of any specific workflow, distinct from both Configure
// (§3.5, node-*kind* authoring) and a Trigger's own per-workflow config
// (§3.4). Two capabilities researched and locked in §3.7's Update:
// launch at login (internal/adapters/launchatlogin, Wails v3's own
// AutostartManager, SMAppService-backed on darwin) and a global
// "summon the app" hotkey (golang.design/x/hotkey, already adopted for
// per-workflow triggers -- same registration mechanism, different
// callback).
type SettingsService struct {
	mu    sync.Mutex
	store settings.Store
	// pluginHasher is the plugin lock's hash source
	// (settingsservice_pluginlock.go), nil until wired.
	pluginHasher PluginHasher
	// pluginPolicyChanged runs after a change to which plugins may run
	// (turned on/off, consent granted/withdrawn), so host-side
	// consumers of the plugin catalog re-read it -- the MCP plane's
	// plugin tools appear and disappear with the toggle, never only
	// after a restart. nil until wired.
	pluginPolicyChanged func()
	// pluginLocator answers where an installed plugin's folder is --
	// set by the composition root, nil on a build with no plugin
	// service (settingsservice_pluginremove.go).
	pluginLocator PluginLocator
	window        *windowing.Window
	// leave is the quit gate's state (settingsservice_flush.go).
	leave leaveGate
	// panel is the Quick Panel window (docs/adr/0033) -- a second,
	// always-alive floating window the summon hotkey toggles, distinct
	// from window (the main window) above. See settingsservice_panel.go.
	panel *windowing.Window
	// trayCountFn mirrors the dock badge's pending count onto the
	// menu-bar label (docs/goals/0189) -- see SetTrayCount.
	trayCountFn func(count int)
	// approvalPrompt is the floating approval-prompt window
	// (docs/goals/0023-attention-escalation.md item 1) -- ADR-0033's
	// second-window mechanism reused, but shown by the backend itself
	// (NotifyPendingApproval's away verdict) rather than toggled by a
	// hotkey. See settingsservice_approvalprompt.go.
	approvalPrompt *windowing.Window
	runMonitor     *windowing.Window
	// capture is the quick-capture window (settingsservice_capture.go).
	capture  *windowing.Window
	trig     *triggersvc.TriggerService
	summon   *hotkey.Binding
	summonHK triggersvc.PersistedHotkey // zero value (nil Mods) means unassigned
	updater  *updater.Updater
	// backupRunner is the pre-update-snapshot seam DownloadAndInstallUpdate
	// calls before any bundle swap (goal 0100) -- an injected closure,
	// never a direct backupsvc import (backend.md), same shape as
	// composition.SetBackupRunner. keepN <= 0 means "use the runner's
	// own default retention."
	backupRunner  func(keepN int) (string, error)
	appVersion    string
	updateChannel string
	// updateDownloading marks an install in flight (goal 0142) -- the
	// UI reads it via UpdateNoticeState so navigating away never
	// forgets a running download.
	updateDownloading bool
	// summonGraceUntil suppresses the focus-yield cascade while a
	// summon is in flight (goal 0151).
	summonGraceUntil time.Time
	// summonHidMain: TogglePanel/ShowPanel hid an already-open main
	// window for THIS summon; yieldFocusIfMainHidden reads+clears it to
	// decide whether to restore main once the panel dismisses (0182).
	summonHidMain bool
	// updateEventSink fires the update-available system event (goal
	// 0146); nil until wired.
	updateEventSink func(version, channel string)
	// The notice pill's state (goal 0122): set by CheckForUpdates when
	// a newer version is found (respecting the persisted per-version
	// dismissal) and by a successful DownloadAndInstallUpdate; read by
	// UpdateNoticeState. In-memory -- both facts are re-derived by the
	// next check/install after a restart.
	availableUpdate string
	updateReady     bool
	// resignWarning carries a non-fatal re-sign failure (goal 0158)
	// forward into the notice pill: the update itself still succeeded,
	// so this rides UpdateNotice rather than failing
	// DownloadAndInstallUpdate. Cleared at the start of the next
	// install attempt.
	resignWarning string
	// stagedUpdateVersion is the version DownloadAndInstallUpdate most
	// recently staged (goal 0175): a published release artifact never
	// changes, so a background tick that finds this same version again
	// skips re-downloading it.
	stagedUpdateVersion string
	// autoUpdateLoopCancel is non-nil exactly while the opt-in
	// background check loop is running (goal 0207) -- startAutoUpdateLoop/
	// stopAutoUpdateLoop's own idempotency flag, so a live toggle can
	// start/stop it without ever risking a second loop or a panic on a
	// redundant stop.
	autoUpdateLoopCancel context.CancelFunc
	// lastCheckAt/lastCheckOutcome/lastCheckError record CheckForUpdates'
	// most recent result (settingsservice_updatenotice.go's
	// recordCheckOutcome), read by UpdateNoticeState -- a check that
	// silently keeps failing must read as a visible state in Settings,
	// never as indistinguishable from "no update available". In-memory,
	// re-derived by the next check after a restart, same as
	// availableUpdate/updateReady above.
	lastCheckAt      time.Time
	lastCheckOutcome UpdateCheckOutcome
	lastCheckError   string
	// checking is true for the duration of a checkForUpdates call
	// (manual, check-on-open, or the background loop's own tick) --
	// the state machine's own "checking" phase (goal 0220 S1), read by
	// UpdateNoticeState so every surface sees the same live phase
	// instead of each deriving its own from a local in-flight promise.
	checking bool
	// lastInstallError carries a NON-supersede DownloadAndInstallUpdate
	// failure into the derived state machine's error phase -- cleared
	// at the start of the next install attempt, same lifecycle as
	// resignWarning. A supersede failure (a newer version found while
	// an earlier one was already ready) never sets this: it routes
	// through recordCheckOutcome instead, since the adopted updater's
	// own DownloadAndInstall unconditionally discards whatever was
	// previously staged before the new attempt even begins (wails/v3
	// pkg/updater's discardStaging), so that failure reads as "the
	// newer update couldn't download" rather than a fresh install
	// error.
	lastInstallError string
	// lastInstallStage classifies lastInstallError (classifyUpdateFailureStage)
	// -- same lifecycle, cleared and set alongside it.
	lastInstallStage UpdateFailureStage
	// lastNotesVersion/lastNotesRaw record the release notes CheckForUpdates
	// most recently found (goal 0220 S2) -- the "What's new" surface's
	// only data source, read (and rendered) by UpdateNoticeState. Set on
	// every found result regardless of pill dismissal, since dismissing
	// the notice pill must never also hide the notes from Settings.
	// Retained across a later up-to-date/failed check so the last known
	// notes stay visible instead of vanishing.
	lastNotesVersion string
	lastNotesRaw     string
	isolatedData     bool
	mcpService       *mcpsvc.MillMCPService
	// notificationSvc is the notification spine's Publish entry point
	// (docs/goals/0171), late-bound the same way mcpService is (nil
	// until SetNotificationService runs) since NotificationService and
	// SettingsService are constructed independently in main.go and
	// SettingsService's own channels (settingsservice_notifychannels.go)
	// register into it afterward.
	notificationSvc *notificationsvc.NotificationService

	// keymap holds command-keybinding OVERRIDES only (goal 0016 --
	// docs/goals/0016-keymap-system.md), keyed by command id
	// (frontend/src/shared/commands.ts owns the full command set + each
	// command's default binding; a command with no entry here is still
	// on its frontend-declared default). See settingsservice_keymap.go.
	keymap map[string]triggersvc.PersistedHotkey

	// menuMu guards menuSuspendCount while a hotkey recorder is armed --
	// see SuspendMenuAccelerators's doc comment (settingsservice_menu.go)
	// for the bug this exists to fix. Deliberately a separate mutex from
	// mu above: this state is orthogonal to every other field here, and
	// none of the menu methods call back into anything that locks mu, so
	// sharing it would only add needless contention. The stripped
	// accelerators themselves are stashed inside internal/adapters/
	// windowing, not here -- this only counts concurrent recorders.
	menuMu           sync.Mutex
	menuSuspendCount int
}

// isolatedData is true whenever MILL_SETTINGS_PATH was set explicitly
// (main.go), meaning this instance is reading/writing a settings.json
// other than the one real default -- true for every e2e run already
// (playwright.config.ts), and deliberately the same signal a
// LAN/Tailscale-reachable server-mode instance should set when it's
// meant to be tested against without touching real desktop-app data.
// Surfaced to the frontend (IsIsolatedData) so a visible "isolated test
// data" indicator never leaves it ambiguous which instance you're
// looking at -- the alternative (sharing the real settings/execution-db
// files between a always-running server-mode instance and the desktop
// app) risks concurrent writes and a scheduled trigger double-firing.
func NewSettingsService(store settings.Store, trig *triggersvc.TriggerService, isolatedData bool) *SettingsService {
	s := &SettingsService{
		store:        store,
		trig:         trig,
		isolatedData: isolatedData,
	}
	s.loadPersistedSummonHotkey()
	s.loadPersistedKeymap()
	// docs/adr/0035: never silently drop a user's old forward config --
	// if the pre-refactor toggle's key is present at all (any value,
	// including "false" -- presence means the user visited the old
	// Settings section, not necessarily that it was on), name the
	// replacement once at startup. Reads nothing else from the key; the
	// old value itself carries no useful migration -- there's no
	// HTTPRequest ID to carry forward into the new seeded workflow's
	// config, since the user still has to pick/confirm their real
	// notification endpoint either way.
	if _, ok := store.Get(legacyForwardApprovalsEnabledKey).(string); ok {
		slog.Info("the Settings > Forward pending approvals toggle moved: enable and re-point the seeded \"Example: Forward pending approvals\" workflow instead (docs/adr/0035)")
	}
	return s
}

// IsIsolatedData reports whether this instance is running against a
// non-default settings path (MILL_SETTINGS_PATH was set) -- see
// NewSettingsService's own doc comment for the full reasoning.
func (s *SettingsService) IsIsolatedData() bool {
	return s.isolatedData
}

// GetBuildInfo reports which commit this running instance was actually
// built from (settingsservice_buildinfo.go) -- surfaced in the footer
// so a stale, still-running process (e.g. a desktop app left open
// across a whole session's worth of commits) is visible at a glance
// instead of only discoverable by comparing two instances side by side.
func (s *SettingsService) GetBuildInfo() BuildInfo {
	return readBuildInfo()
}

// SetWindow wires the window a summon-hotkey fire shows/focuses. Called
// once from main.go right after the window is created -- the window
// doesn't exist yet when SettingsService itself is constructed (it's
// created after application.New(), which needs every Service already
// built), same "wire the rest after construction" shape as
// CompositionService.SetSyncer.
//
//wails:ignore
func (s *SettingsService) SetWindow(w *windowing.Window) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.window = w
}

// ShowWindow brings the main window to the front -- the tray icon's
// click handler and its menu's "Show Mill" item (main.go, task #8,
// docs/SPEC.md §3.7) and OpenMainWindow (settingsservice_panel.go, the
// Quick Panel's "Open Mill"/"Open Settings" rows) all reach it.
// bringMainToFront (settingsservice_presence.go) does the actual work,
// including un-hiding the app first -- goal 0186's fix: this used to
// order the window in without that step, so it silently did nothing
// whenever Mill had been app-hidden.
//
//wails:ignore
func (s *SettingsService) ShowWindow() {
	s.mu.Lock()
	w := s.window
	s.mu.Unlock()
	bringMainToFront(w)
}

// GetLaunchAtLogin queries the real OS registration state via
// SMAppService (internal/adapters/launchatlogin) rather than a
// persisted preference -- authoritative even if the user changed it
// directly in System Settings, which a cached flag would silently
// miss. Returns one of launchatlogin's three LoginItemStatus values:
// "disabled", "enabled", or "requires-approval" (registered, but
// macOS is holding it for the user's explicit confirmation).
func (s *SettingsService) GetLaunchAtLogin() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	status, err := launchatlogin.Status(exe)
	return string(status), err
}

// SetLaunchAtLogin enables or disables starting Mill automatically at
// login. Returns launchatlogin.ErrNotAppBundle when running as a bare
// dev binary (not a real .app bundle) -- a real, user-facing
// limitation, not a bug to work around.
func (s *SettingsService) SetLaunchAtLogin(enabled bool) error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	if enabled {
		return launchatlogin.Enable(exe)
	}
	return launchatlogin.Disable(exe)
}

// GetMCPWriteEnabled/SetMCPWriteEnabled own the default-off gate for
// Mill's MCP import tools (millmcpservice_tools.go, ADR-0017's
// Update): whether an external MCP client may create workflows/
// Configure entities on this instance. Default off -- absence of the
// key means disabled, same fail-safe posture as §8's guardrail
// default. The MCP service reads the same key fresh per call, so a
// toggle applies immediately.
func (s *SettingsService) GetMCPWriteEnabled() bool {
	v, ok := s.store.Get(mcpsvc.MCPWriteEnabledKey).(string)
	return ok && v == "true"
}

// SetMCPWriteEnabled returns the persist error (docs/goals/0025 item 1)
// rather than swallowing it -- this is a security-relevant toggle
// (whether an external MCP client may write to this instance at all);
// a click that silently failed to take effect is exactly the kind of
// gap §8's fail-safe posture exists to prevent.
func (s *SettingsService) SetMCPWriteEnabled(enabled bool) error {
	val := "false"
	if enabled {
		val = "true"
	}
	if err := s.store.Set(mcpsvc.MCPWriteEnabledKey, val); err != nil {
		return fmt.Errorf("save MCP write toggle: %w", err)
	}
	return nil
}

// GetMCPWriteApprovalRequired/SetMCPWriteApprovalRequired own the
// per-write approval toggle layered on the write gate above
// (millmcpservice_approval.go, docs/adr/0032's park-and-poll lifecycle):
// with writes enabled, each import still parks for a human decision
// unless this is explicitly relaxed. Defaults to REQUIRED when unset --
// enabling writes must not silently mean unattended writes (§8's
// fail-safe default).
func (s *SettingsService) GetMCPWriteApprovalRequired() bool {
	v, ok := s.store.Get(mcpsvc.MCPWriteApprovalKey).(string)
	if !ok || v == "" {
		return true
	}
	return v == "true"
}

// SetMCPWriteApprovalRequired returns the persist error, same reasoning
// as SetMCPWriteEnabled -- relaxing this to "unattended" (required =
// false) failing to save silently is a security-relevant gap;
// re-tightening it (required = true) failing to save silently would be
// worse (the user believes approval is required again when it isn't).
func (s *SettingsService) SetMCPWriteApprovalRequired(required bool) error {
	val := "false"
	if required {
		val = "true"
	}
	if err := s.store.Set(mcpsvc.MCPWriteApprovalKey, val); err != nil {
		return fmt.Errorf("save MCP write approval toggle: %w", err)
	}
	return nil
}

// SetMCPService late-binds the MCP service so the two pending-write
// RPCs below can delegate -- same late-bound-setter shape as
// SetReservedCombo (MillMCPService is constructed after this service).
//
//wails:ignore
func (s *SettingsService) SetMCPService(m *mcpsvc.MillMCPService) { s.mcpService = m }

// SetNotificationService late-binds the notification spine's Publish
// entry point (docs/goals/0171) -- same late-bound-setter shape as
// SetMCPService above (NotificationService is constructed independently
// in main.go). NotifyPendingApproval no-ops the Publish call when this
// is still nil (every test that constructs SettingsService directly
// without wiring it, same "nil sink means dropped" posture
// SetSystemEventSink's own doc comment already documents elsewhere).
//
//wails:ignore
func (s *SettingsService) SetNotificationService(n *notificationsvc.NotificationService) {
	s.notificationSvc = n
}

// PendingMCPWrites lists MCP writes currently awaiting a human
// decision (millmcpservice_approval.go, docs/adr/0032).
func (s *SettingsService) PendingMCPWrites() []mcpsvc.MCPWriteRequest {
	if s.mcpService == nil {
		return nil
	}
	return s.mcpService.PendingMCPWrites()
}

// ResolveMCPWrite delivers the human's decision to a parked MCP write.
func (s *SettingsService) ResolveMCPWrite(id string, approve bool) error {
	if s.mcpService == nil {
		return fmt.Errorf("MCP service not running")
	}
	return s.mcpService.ResolveMCPWrite(id, approve)
}

// ResolvedMCPWrites lists every already-resolved MCP write still in its
// 24h retention window (docs/goals/0026 item 6) -- Review's
// Recently-resolved section reads this alongside its own resolved runs.
func (s *SettingsService) ResolvedMCPWrites() []mcpsvc.MCPWriteResolved {
	if s.mcpService == nil {
		return nil
	}
	return s.mcpService.ResolvedMCPWrites()
}

// DebugBackdatePendingMCPWrite is an e2e-only test knob (docs/goals/0026
// item 2's staleness presentation) -- see MillMCPService.
// DebugBackdatePendingWrite's own doc comment for why this has to be an
// in-process call rather than an external settings-file edit. Refuses
// outside isolated test data (the same IsIsolatedData signal every
// e2e run already sets via MILL_SETTINGS_PATH) -- never reachable
// against a real production instance.
func (s *SettingsService) DebugBackdatePendingMCPWrite(id string, ageMinutes int) error {
	if !s.isolatedData {
		return fmt.Errorf("debug test knobs are only available against isolated test data")
	}
	if s.mcpService == nil {
		return fmt.Errorf("MCP service not running")
	}
	return s.mcpService.DebugBackdatePendingWrite(id, ageMinutes)
}

// DebugAssignWorkflowHotkey is an e2e-only test knob, same gating as
// DebugBackdatePendingMCPWrite above: workflow-hotkey-trigger e2e
// coverage needs a combo actually recorded against a workflow, but real
// hotkey assignment (TriggerService.AssignHotkey) always fails outside a
// native run loop (see TriggerService.DebugAssignHotkey's own doc
// comment) -- this delegates to that bypass, gated the same way.
func (s *SettingsService) DebugAssignWorkflowHotkey(workflowID string, mods []string, key string) (string, error) {
	if !s.isolatedData {
		return "", fmt.Errorf("debug test knobs are only available against isolated test data")
	}
	return s.trig.DebugAssignHotkey(workflowID, mods, key)
}
