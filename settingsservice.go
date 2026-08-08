package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sync"

	"github.com/alicoding/mill/internal/adapters/hotkey"
	"github.com/alicoding/mill/internal/adapters/launchatlogin"
	"github.com/alicoding/mill/internal/adapters/settings"
	"github.com/alicoding/mill/internal/domain/trigger"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// summonHotkeyKey persists the app-level summon hotkey's (mods, key)
// pair -- same one-atomic-JSON-blob-per-key shape as
// triggerHotkeyBindingsKey (triggerservice.go), sharing the same
// settings.json file rather than a second store/file.
const summonHotkeyKey = "settings-summon-hotkey"

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
			s.mu.Lock()
			w := s.window
			s.mu.Unlock()
			if w == nil {
				continue
			}
			w.Show()
			w.Restore()
			w.Focus()
		}
	}()
	return nil
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
