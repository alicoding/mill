package settingssvc

import (
	"encoding/json"
	"errors"
	"fmt"

	"github.com/alicoding/mill/internal/adapters/hotkey"
	"github.com/alicoding/mill/internal/domain/trigger"
	"github.com/alicoding/mill/internal/services/triggersvc"
)

// Split out of settingsservice.go once that file crossed the 500-line
// limit (.claude/rules/architecture.md) -- the summon-hotkey concern
// (persistence, bind/unbind, conflict checking against per-workflow
// triggers) is self-contained enough to be its own file, same "split
// along a real seam" shape as settingsservice_buildinfo.go before it.
// No behavior change: every method here is still on *SettingsService,
// still guarded by the same s.mu the rest of the service uses.

func (s *SettingsService) loadPersistedSummonHotkey() {
	raw, ok := s.store.Get(summonHotkeyKey).(string)
	if !ok || raw == "" {
		return
	}
	var hk triggersvc.PersistedHotkey
	if err := json.Unmarshal([]byte(raw), &hk); err != nil {
		return
	}
	s.mu.Lock()
	s.summonHK = hk
	s.mu.Unlock()
}

func (s *SettingsService) persistSummonHotkey() error {
	s.mu.Lock()
	hk := s.summonHK
	s.mu.Unlock()
	data, err := json.Marshal(hk)
	if err != nil {
		return fmt.Errorf("marshal summon hotkey: %w", err)
	}
	if err := s.store.Set(summonHotkeyKey, string(data)); err != nil {
		return fmt.Errorf("persist summon hotkey: %w", err)
	}
	return nil
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
	// docs/adr/0033: the summon hotkey now TOGGLES the Quick Panel
	// (visible -> dismiss it, hidden -> show+focus it) rather than
	// showing the main window directly -- ShowWindow stays reachable
	// via the tray icon's own click handler and the panel's own
	// "Open Mill" row (OpenMainWindow), just no longer via this hotkey.
	go summonKeydownLoop(b.Keydown(), s.TogglePanel)
	return nil
}

// summonKeydownLoop drains events (b.Keydown()'s producer, never the OS
// main thread) and calls toggle on each fire. toggle (TogglePanel)
// reaches App-level Show/Hide, and AppKit aborts the process if that's
// touched off the main thread -- but every such call inside TogglePanel
// now marshals itself individually (internal/adapters/windowing's
// runMainThreadAction), so this loop no longer needs its own outer
// main-thread seam the way the P0 fix originally added one here.
// Extracted from bindSummon as its own function so the routing can be
// proven with a fake events channel -- hotkey.Bind's real registration
// needs the Accessibility permission a headless test process never has.
func summonKeydownLoop(events <-chan struct{}, toggle func()) {
	for range events {
		toggle()
	}
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
		if wf, ok := s.trig.FindWorkflow(conflictID); ok {
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
	previousHK := s.summonHK
	if s.summon != nil {
		_ = s.summon.Unbind()
		s.summon = nil
	}
	s.summonHK = triggersvc.PersistedHotkey{Mods: mods, Key: key}
	s.mu.Unlock()

	if err := s.persistSummonHotkey(); err != nil {
		// Roll the persisted-state record back so memory matches what's
		// actually on disk (docs/goals/0025 item 2) -- note this does
		// NOT re-establish the previous OS-level binding, which was
		// already unbound above; on this failure path nothing is
		// actually bound until the user retries (a narrower gap than
		// leaving mismatched state, and the same shape as most other
		// hotkey-unbind failures in this file, which are already
		// best-effort `_ = ...Unbind()`).
		s.mu.Lock()
		s.summonHK = previousHK
		s.mu.Unlock()
		return "", fmt.Errorf("save summon hotkey: %w", err)
	}

	if err := s.bindSummon(mods, key); err != nil {
		return "", err
	}
	return triggersvc.FormatBinding(mods, key), nil
}

// UnassignSummonHotkey removes the app-level summon hotkey, if any.
// Returns the persist error (docs/goals/0025 item 1) rather than
// swallowing it, restoring the in-memory record on failure so it
// matches what's still on disk.
func (s *SettingsService) UnassignSummonHotkey() error {
	s.mu.Lock()
	previousHK := s.summonHK
	if s.summon != nil {
		_ = s.summon.Unbind()
		s.summon = nil
	}
	s.summonHK = triggersvc.PersistedHotkey{}
	s.mu.Unlock()

	if err := s.persistSummonHotkey(); err != nil {
		s.mu.Lock()
		s.summonHK = previousHK
		s.mu.Unlock()
		return fmt.Errorf("save summon hotkey removal: %w", err)
	}
	return nil
}

// GetSummonHotkey returns the current summon hotkey's human-readable
// binding label (e.g. "⌥⇧Space"), or "" if unassigned.
func (s *SettingsService) GetSummonHotkey() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.summonHK.Mods) == 0 {
		return ""
	}
	return triggersvc.FormatBinding(s.summonHK.Mods, s.summonHK.Key)
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
