// Package settingssvc is the Wails-facing layer over Mill's own
// app-level settings -- config that applies to Mill itself (launch at
// login, the summon hotkey, window geometry, build/update state)
// independent of any specific workflow, distinct from both Configure
// (node-kind authoring) and a Trigger's per-workflow config.
package settingssvc

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"sync"
	"time"

	"github.com/alicoding/mill/internal/adapters/hotkey"
	"github.com/alicoding/mill/internal/adapters/launchatlogin"
	"github.com/alicoding/mill/internal/adapters/settings"
	"github.com/alicoding/mill/internal/services/mcpsvc"
	"github.com/alicoding/mill/internal/services/triggersvc"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
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

// windowGeometryKey persists window position/size/maximized state --
// docs/SPEC.md §3.7's Update. Same one-atomic-JSON-blob-per-key shape
// as summonHotkeyKey.
const windowGeometryKey = "settings-window-geometry"

// windowGeometryDebounce batches rapid move/resize events (dragging a
// window fires dozens of them) into one write -- the same reasoning
// Electron's own de facto window-state-keeper convention uses
// (confirmed directly, docs/SPEC.md §3.7's research).
const windowGeometryDebounce = 500 * time.Millisecond

// SettingsService is the Wails-facing layer over docs/SPEC.md §3.7's
// "global app settings" -- settings that apply to Mill itself,
// independent of any specific workflow, distinct from both Configure
// (§3.5, node-*kind* authoring) and a Trigger's own per-workflow config
// (§3.4). Two capabilities researched and locked in §3.7's Update:
// launch at login (internal/adapters/launchatlogin, no official Wails3
// mechanism, ported from Wails v2's own osascript-based one) and a
// global "summon the app" hotkey (golang.design/x/hotkey, already
// adopted for per-workflow triggers -- same registration mechanism,
// different callback).
type SettingsService struct {
	mu     sync.Mutex
	store  settings.Store
	window *application.WebviewWindow
	// panel is the Quick Panel window (docs/adr/0033) -- a second,
	// always-alive floating window the summon hotkey toggles, distinct
	// from window (the main window) above. See settingsservice_panel.go.
	panel *application.WebviewWindow
	// approvalPrompt is the floating approval-prompt window
	// (docs/goals/0023-attention-escalation.md item 1) -- ADR-0033's
	// second-window mechanism reused, but shown by the backend itself
	// (NotifyPendingApproval's away verdict) rather than toggled by a
	// hotkey. See settingsservice_approvalprompt.go.
	approvalPrompt *application.WebviewWindow
	trig           *triggersvc.TriggerService
	summon         *hotkey.Binding
	summonHK       triggersvc.PersistedHotkey // zero value (nil Mods) means unassigned
	updater        *updater.Updater
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
	// The notice pill's state (goal 0122): set by CheckForUpdates when
	// a newer version is found (respecting the persisted per-version
	// dismissal) and by a successful DownloadAndInstallUpdate; read by
	// UpdateNoticeState. In-memory -- both facts are re-derived by the
	// next check/install after a restart.
	availableUpdate string
	updateReady     bool
	isolatedData    bool
	mcpService      *mcpsvc.MillMCPService

	// keymap holds command-keybinding OVERRIDES only (goal 0016 --
	// docs/goals/0016-keymap-system.md), keyed by command id
	// (frontend/src/shared/commands.ts owns the full command set + each
	// command's default binding; a command with no entry here is still
	// on its frontend-declared default). See settingsservice_keymap.go.
	keymap map[string]triggersvc.PersistedHotkey

	// menuMu guards the native application menu's key-equivalents while a
	// hotkey recorder is armed -- see SuspendMenuAccelerators's doc
	// comment (settingsservice_menu.go) for the bug this exists to fix.
	// Deliberately a separate mutex from mu above: this state is
	// orthogonal to every other field here, and none of the menu methods
	// call back into anything that locks mu, so sharing it would only add
	// needless contention.
	menuMu            sync.Mutex
	menuSuspendCount  int
	savedAccelerators map[*application.MenuItem]string
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
	s := &SettingsService{store: store, trig: trig, isolatedData: isolatedData}
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
func (s *SettingsService) SetWindow(w *application.WebviewWindow) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.window = w
}

// windowGeometry is the persisted shape -- Fullscreen deliberately not
// tracked (see WatchWindowGeometry's own doc comment for why).
type windowGeometry struct {
	X, Y, Width, Height int
	Maximized           bool
}

// valid rejects a persisted position that would place the window
// somewhere very unlikely to be a real, currently-attached display.
// Wails3 (like Wails v2 before it -- wailsapp/wails#2739, confirmed
// directly) has no monitor-identity API: a window last positioned on a
// monitor that's since been disconnected can't be correctly relocated,
// only guarded against landing somewhere catastrophically inaccessible
// (e.g. a saved position from a since-removed external display sitting
// far off the primary screen's bounds). Not a full multi-monitor
// solution -- a known, accepted limitation, not silently pretended
// away (docs/SPEC.md §3.7's research).
func (g windowGeometry) valid() bool {
	return g.X > -50 && g.Y > -50 && g.X < 10000 && g.Y < 10000 && g.Width > 0 && g.Height > 0
}

// LoadWindowGeometry returns the persisted window geometry, if any and
// if it passes the basic off-screen guard above. Called from main.go
// before the window is created, so the saved position/size can be
// applied via WebviewWindowOptions' own X/Y/Width/Height/StartState
// fields -- there's no "move it after creation" path that avoids an
// initial flash at the default position/size. Go-internal wiring only,
// same as SetWindow/WatchWindowGeometry -- never meant to be called
// from the frontend (there's nothing for a window-geometry read to do
// there), just missed the //wails:ignore marker those two already have
// when this was first written.
//
//wails:ignore
func (s *SettingsService) LoadWindowGeometry() (x, y, width, height int, maximized bool, ok bool) {
	raw, isStr := s.store.Get(windowGeometryKey).(string)
	if !isStr || raw == "" {
		return 0, 0, 0, 0, false, false
	}
	var g windowGeometry
	if err := json.Unmarshal([]byte(raw), &g); err != nil || !g.valid() {
		return 0, 0, 0, 0, false, false
	}
	return g.X, g.Y, g.Width, g.Height, g.Maximized, true
}

// persistWindowGeometry is called from a debounced OnWindowEvent
// callback (WatchWindowGeometry below), not a request a caller is
// waiting on -- genuinely fire-and-forget background state, docs/goals/
// 0025 item 1's own named example. Logged rather than silently dropped
// so a persistent failure (e.g. a corrupted settings file) is at least
// diagnosable; a single failed write just means the window reopens at
// its default position/size next launch, not a data-loss-shaped bug.
func (s *SettingsService) persistWindowGeometry(g windowGeometry) {
	data, err := json.Marshal(g)
	if err != nil {
		slog.Error("failed to marshal window geometry", "error", err)
		return
	}
	if err := s.store.Set(windowGeometryKey, string(data)); err != nil {
		slog.Error("failed to persist window geometry", "error", err)
	}
}

// WatchWindowGeometry wires OnWindowEvent listeners (events.Common.
// WindowDidMove/WindowDidResize/WindowMaximise/WindowUnMaximise/
// WindowRestore -- confirmed real against the actual Wails3 SDK source,
// not assumed) that debounce-persist the window's position/size/
// maximized state on every real change. Called once from main.go,
// right after SetWindow. Fullscreen is deliberately not tracked:
// reapplying a persisted X/Y/Width/Height to a window that was last in
// fullscreen would be meaningless (macOS fullscreen occupies its own
// Space, with real, unresolved multi-monitor questions of its own,
// docs/SPEC.md §3.7) -- a real, named future gap rather than a guess.
//
//wails:ignore
func (s *SettingsService) WatchWindowGeometry() {
	s.mu.Lock()
	w := s.window
	s.mu.Unlock()
	if w == nil {
		return
	}

	var timerMu sync.Mutex
	var timer *time.Timer
	persist := func() {
		x, y := w.Position()
		width, height := w.Size()
		s.persistWindowGeometry(windowGeometry{X: x, Y: y, Width: width, Height: height, Maximized: w.IsMaximised()})
	}
	debounced := func(*application.WindowEvent) {
		timerMu.Lock()
		defer timerMu.Unlock()
		if timer != nil {
			timer.Stop()
		}
		timer = time.AfterFunc(windowGeometryDebounce, persist)
	}

	for _, evt := range []events.WindowEventType{
		events.Common.WindowDidMove,
		events.Common.WindowDidResize,
		events.Common.WindowMaximise,
		events.Common.WindowUnMaximise,
		events.Common.WindowRestore,
	} {
		w.OnWindowEvent(evt, debounced)
	}
}

// ShowWindow brings the main window to the front -- shared by the
// summon-hotkey fire path above and the tray icon's click handler
// (task #8, docs/SPEC.md §3.7), same show/restore/focus sequence
// either way rather than two copies of it. A no-op if the window
// hasn't been wired yet (SetWindow not yet called), matching the
// hotkey path's own existing nil guard.
//
//wails:ignore
func (s *SettingsService) ShowWindow() {
	s.mu.Lock()
	w := s.window
	s.mu.Unlock()
	if w == nil {
		return
	}
	w.Show()
	w.Restore()
	w.Focus()
}

// GetLaunchAtLogin queries the real OS state (System Events' login
// items list) rather than a persisted preference -- authoritative even
// if the user removed Mill from Login Items via System Settings
// directly, which a cached flag would silently miss.
func (s *SettingsService) GetLaunchAtLogin() (bool, error) {
	exe, err := os.Executable()
	if err != nil {
		return false, err
	}
	return launchatlogin.IsEnabled(exe)
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
