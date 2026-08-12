package settingssvc

import (
	"encoding/json"
	"fmt"

	"github.com/alicoding/mill/internal/domain/trigger"
	"github.com/alicoding/mill/internal/services/triggersvc"
)

// Split out of settingsservice.go, same "own file per self-contained
// concern" shape as settingsservice_summonhotkey.go before it (docs/
// goals/0016-keymap-system.md). Command-keybinding overrides are a
// smaller cousin of the summon hotkey: same one-atomic-JSON-blob
// persistence shape, same conflict-check-before-store discipline, but
// no real OS hotkey.Bind at all -- every command here (tab.close,
// workflow.save, view.*, ...) is dispatched by App.tsx's own in-window
// keydown listener (frontend/src/shared/commands.ts), never a
// golang.design/x/hotkey registration, so there's nothing to
// bind/unbind on the Go side beyond persisting the override.
//
// The full command set and each command's DEFAULT binding live only in
// commands.ts -- this service deliberately never mirrors that list.
// That means one real limitation, by design rather than oversight: a
// combo still on its frontend-only default can't be conflict-checked
// against here (this package doesn't know it exists yet). commands.ts's
// own doc comment covers the other half of that conflict check
// (computing each command's EFFECTIVE binding -- default merged with
// whatever ListKeybindings returns -- and rejecting a clash before
// SetKeybinding is ever called). What IS checked here, authoritatively,
// is a combo already claimed by another OVERRIDDEN command, or by a
// per-workflow trigger hotkey (TriggerService.ClaimedCombos) -- the
// same "one conflict space" reasoning AssignSummonHotkey already
// applies to the summon hotkey (settingsservice_summonhotkey.go).

// keymapKey persists command-keybinding overrides -- one atomic JSON
// blob, same shape as summonHotkeyKey/triggersvc.HotkeyBindingsKey.
const keymapKey = "settings-command-keybindings"

func (s *SettingsService) loadPersistedKeymap() {
	raw, ok := s.store.Get(keymapKey).(string)
	if !ok || raw == "" {
		return
	}
	var persisted map[string]triggersvc.PersistedHotkey
	if err := json.Unmarshal([]byte(raw), &persisted); err != nil {
		return
	}
	s.mu.Lock()
	s.keymap = persisted
	s.mu.Unlock()
}

func (s *SettingsService) persistKeymap() error {
	s.mu.Lock()
	raw := make(map[string]triggersvc.PersistedHotkey, len(s.keymap))
	for id, hk := range s.keymap {
		raw[id] = hk
	}
	s.mu.Unlock()

	data, err := json.Marshal(raw)
	if err != nil {
		return fmt.Errorf("marshal command keybindings: %w", err)
	}
	if err := s.store.Set(keymapKey, string(data)); err != nil {
		return fmt.Errorf("persist command keybindings: %w", err)
	}
	return nil
}

// ListKeybindings returns every command-keybinding OVERRIDE, raw
// (mods+key, not pre-formatted) -- the frontend formats for display
// itself (shared/keybinding.ts's formatCombo) so a default binding
// (never round-tripped through here) and an overridden one render
// identically. Keyed by command id; a command with no entry is still on
// its frontend-declared default.
func (s *SettingsService) ListKeybindings() map[string]triggersvc.PersistedHotkey {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make(map[string]triggersvc.PersistedHotkey, len(s.keymap))
	for id, hk := range s.keymap {
		out[id] = hk
	}
	return out
}

// SetKeybinding overrides commandID's binding to mods+key, rejecting a
// combo already claimed by another command's override, or by a
// per-workflow trigger hotkey (see this file's own header comment for
// why a still-default command can't be checked here). Returns the new
// binding's formatted label (e.g. "⌘⇧S"), same success shape as
// TriggerService.AssignHotkey / SettingsService.AssignSummonHotkey.
func (s *SettingsService) SetKeybinding(commandID string, mods []string, key string) (string, error) {
	if commandID == "" {
		return "", fmt.Errorf("commandID is required")
	}
	if len(mods) == 0 {
		return "", fmt.Errorf("at least one modifier (cmd/ctrl/shift/option) is required")
	}

	s.mu.Lock()
	existing := make([]trigger.HotkeyBinding, 0, len(s.keymap))
	for id, hk := range s.keymap {
		existing = append(existing, trigger.HotkeyBinding{WorkflowID: id, Mods: hk.Mods, Key: hk.Key})
	}
	s.mu.Unlock()

	if conflictID, found := trigger.CheckConflict(existing, mods, key, commandID); found {
		return "", fmt.Errorf("this combo is already bound to command %q -- pick another, or reset it there first", conflictID)
	}
	if conflictID, found := trigger.CheckConflict(s.trig.ClaimedCombos(), mods, key, ""); found {
		label := conflictID
		if wf, ok := s.trig.FindWorkflow(conflictID); ok {
			label = wf.Label
		}
		return "", fmt.Errorf("this combo is already bound to workflow %q -- pick another, or unassign it there first", label)
	}

	s.mu.Lock()
	if s.keymap == nil {
		s.keymap = map[string]triggersvc.PersistedHotkey{}
	}
	previous, hadPrevious := s.keymap[commandID]
	s.keymap[commandID] = triggersvc.PersistedHotkey{Mods: mods, Key: key}
	s.mu.Unlock()

	if err := s.persistKeymap(); err != nil {
		// Don't leave a phantom-saved override in memory that a restart
		// would drop (docs/goals/0025 item 2) -- restore whatever was
		// there before (nothing, for a command that was still on its
		// frontend default).
		s.mu.Lock()
		if hadPrevious {
			s.keymap[commandID] = previous
		} else {
			delete(s.keymap, commandID)
		}
		s.mu.Unlock()
		return "", fmt.Errorf("save keybinding: %w", err)
	}

	return triggersvc.FormatBinding(mods, key), nil
}

// ClearKeybinding removes commandID's override, if any, reverting it to
// its frontend-declared default binding. Returns the persist error
// (docs/goals/0025 item 1) rather than swallowing it, and restores the
// removed override in memory if the save failed, so a user who thinks
// they cleared a binding doesn't have it silently come back after a
// restart while the UI shows it as already cleared.
func (s *SettingsService) ClearKeybinding(commandID string) error {
	s.mu.Lock()
	previous, existed := s.keymap[commandID]
	delete(s.keymap, commandID)
	s.mu.Unlock()

	if err := s.persistKeymap(); err != nil {
		if existed {
			s.mu.Lock()
			s.keymap[commandID] = previous
			s.mu.Unlock()
		}
		return fmt.Errorf("save keybinding clear: %w", err)
	}
	return nil
}
