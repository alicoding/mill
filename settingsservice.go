package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/alicoding/mill/internal/adapters/hotkey"
	"github.com/alicoding/mill/internal/adapters/launchatlogin"
	"github.com/alicoding/mill/internal/adapters/settings"
	"github.com/alicoding/mill/internal/domain/trigger"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
	"github.com/wailsapp/wails/v3/pkg/updater"
)

// summonHotkeyKey persists the app-level summon hotkey's (mods, key)
// pair -- same one-atomic-JSON-blob-per-key shape as
// triggerHotkeyBindingsKey (triggerservice.go), sharing the same
// settings.json file rather than a second store/file.
const summonHotkeyKey = "settings-summon-hotkey"

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
	mu       sync.Mutex
	store    settings.Store
	window   *application.WebviewWindow
	trig     *TriggerService
	summon   *hotkey.Binding
	summonHK persistedHotkey // zero value (nil Mods) means unassigned
	updater  *updater.Updater
}

func NewSettingsService(store settings.Store, trig *TriggerService) *SettingsService {
	s := &SettingsService{store: store, trig: trig}
	s.loadPersistedSummonHotkey()
	return s
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

func (s *SettingsService) persistWindowGeometry(g windowGeometry) {
	data, err := json.Marshal(g)
	if err != nil {
		return
	}
	_ = s.store.Set(windowGeometryKey, string(data))
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

func (s *SettingsService) loadPersistedSummonHotkey() {
	raw, ok := s.store.Get(summonHotkeyKey).(string)
	if !ok || raw == "" {
		return
	}
	var hk persistedHotkey
	if err := json.Unmarshal([]byte(raw), &hk); err != nil {
		return
	}
	s.mu.Lock()
	s.summonHK = hk
	s.mu.Unlock()
}

func (s *SettingsService) persistSummonHotkey() {
	s.mu.Lock()
	hk := s.summonHK
	s.mu.Unlock()
	data, err := json.Marshal(hk)
	if err != nil {
		return
	}
	_ = s.store.Set(summonHotkeyKey, string(data))
}

// RestoreSummonHotkey re-registers a persisted summon hotkey on launch
// -- called from main.go's ApplicationStarted handler, same timing
// reasoning as TriggerService.Sync (global hotkey registration needs
// the native run loop already spinning, docs/SPEC.md §2.2).
func (s *SettingsService) RestoreSummonHotkey() {
	s.mu.Lock()
	hk := s.summonHK
	s.mu.Unlock()
	if len(hk.Mods) == 0 {
		return
	}
	if err := s.bindSummon(hk.Mods, hk.Key); err != nil {
		return
	}
}

func (s *SettingsService) bindSummon(mods []string, key string) error {
	b, err := hotkey.Bind(mods, key)
	if err != nil {
		return err
	}
	s.mu.Lock()
	s.summon = b
	s.mu.Unlock()
	go func() {
		for range b.Keydown() {
			s.ShowWindow()
		}
	}()
	return nil
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

// AssignSummonHotkey binds mods+key as the app-level summon hotkey,
// replacing any previous one. Rejects a combo already claimed by a
// per-workflow trigger (TriggerService.ClaimedCombos) -- the reverse
// direction of the check TriggerService.AssignHotkey does via
// SetReservedCombo.
func (s *SettingsService) AssignSummonHotkey(mods []string, key string) (string, error) {
	if len(mods) == 0 {
		return "", fmt.Errorf("at least one modifier (cmd/ctrl/shift/option) is required")
	}
	if conflictID, found := trigger.CheckConflict(s.trig.ClaimedCombos(), mods, key, ""); found {
		label := conflictID
		if wf, ok := s.trig.findWorkflow(conflictID); ok {
			label = wf.Label
		}
		return "", fmt.Errorf("this combo is already bound to workflow %q -- pick another, or unassign it there first", label)
	}

	// Probe the combo registers before committing to it -- same
	// probe-then-real-bind shape as TriggerService.AssignHotkey.
	probe, err := hotkey.Bind(mods, key)
	if err != nil {
		if errors.Is(err, hotkey.ErrRegisterFailed) {
			return "", fmt.Errorf("this Mac hasn't granted Mill Accessibility permission yet (System Settings → Privacy & Security → Accessibility), or the combo is already taken by another app: %w", err)
		}
		return "", err
	}
	_ = probe.Unbind()

	s.mu.Lock()
	if s.summon != nil {
		_ = s.summon.Unbind()
		s.summon = nil
	}
	s.summonHK = persistedHotkey{Mods: mods, Key: key}
	s.mu.Unlock()
	s.persistSummonHotkey()

	if err := s.bindSummon(mods, key); err != nil {
		return "", err
	}
	return formatBinding(mods, key), nil
}

// UnassignSummonHotkey removes the app-level summon hotkey, if any.
func (s *SettingsService) UnassignSummonHotkey() {
	s.mu.Lock()
	if s.summon != nil {
		_ = s.summon.Unbind()
		s.summon = nil
	}
	s.summonHK = persistedHotkey{}
	s.mu.Unlock()
	s.persistSummonHotkey()
}

// GetSummonHotkey returns the current summon hotkey's human-readable
// binding label (e.g. "⌥⇧Space"), or "" if unassigned.
func (s *SettingsService) GetSummonHotkey() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.summonHK.Mods) == 0 {
		return ""
	}
	return formatBinding(s.summonHK.Mods, s.summonHK.Key)
}

// ReservedCombo implements the func signature TriggerService.SetReservedCombo
// expects -- wired from main.go once both services exist.
//
//wails:ignore
func (s *SettingsService) ReservedCombo() (mods []string, key string, ok bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.summonHK.Mods) == 0 {
		return nil, "", false
	}
	return s.summonHK.Mods, s.summonHK.Key, true
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

// SetUpdater wires Wails3's own app.Updater singleton (constructed by
// application.New() itself, already Init'd by main.go with a GitHub
// Releases provider) -- set after app construction, same "wire the
// rest after construction" shape as SetWindow. docs/SPEC.md §3.7's
// research confirmed this needs no new dependency: v3/pkg/updater is
// Wails3's own first-party package.
//
//wails:ignore
func (s *SettingsService) SetUpdater(u *updater.Updater) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.updater = u
}

// UpdateCheckResult is CheckForUpdates' Wails-bound result shape.
type UpdateCheckResult struct {
	UpdateAvailable bool   `json:"updateAvailable"`
	Version         string `json:"version"`
	Notes           string `json:"notes"`
}

// CheckForUpdates asks the configured provider (GitHub Releases,
// alicoding/mill) whether a newer version exists. Inert until Mill has
// a real tagged-release process -- see docs/SPEC.md §3.7's own note on
// this; wired now so the mechanism exists, not claiming a working
// update pipeline exists yet.
func (s *SettingsService) CheckForUpdates() (UpdateCheckResult, error) {
	s.mu.Lock()
	u := s.updater
	s.mu.Unlock()
	if u == nil {
		return UpdateCheckResult{}, fmt.Errorf("updater not configured")
	}
	rel, err := u.Check(context.Background())
	if err != nil {
		return UpdateCheckResult{}, err
	}
	if rel == nil {
		return UpdateCheckResult{UpdateAvailable: false}, nil
	}
	return UpdateCheckResult{UpdateAvailable: true, Version: rel.Version, Notes: rel.Notes}, nil
}
