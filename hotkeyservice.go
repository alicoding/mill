package main

import (
	"fmt"
	"os/exec"
	"strings"
	"sync"

	"golang.design/x/hotkey"
)

var keyByName = map[string]hotkey.Key{
	"A": hotkey.KeyA, "B": hotkey.KeyB, "C": hotkey.KeyC, "D": hotkey.KeyD,
	"E": hotkey.KeyE, "F": hotkey.KeyF, "G": hotkey.KeyG, "H": hotkey.KeyH,
	"I": hotkey.KeyI, "J": hotkey.KeyJ, "K": hotkey.KeyK, "L": hotkey.KeyL,
	"M": hotkey.KeyM, "N": hotkey.KeyN, "O": hotkey.KeyO, "P": hotkey.KeyP,
	"Q": hotkey.KeyQ, "R": hotkey.KeyR, "S": hotkey.KeyS, "T": hotkey.KeyT,
	"U": hotkey.KeyU, "V": hotkey.KeyV, "W": hotkey.KeyW, "X": hotkey.KeyX,
	"Y": hotkey.KeyY, "Z": hotkey.KeyZ,
	"0": hotkey.Key0, "1": hotkey.Key1, "2": hotkey.Key2, "3": hotkey.Key3,
	"4": hotkey.Key4, "5": hotkey.Key5, "6": hotkey.Key6, "7": hotkey.Key7,
	"8": hotkey.Key8, "9": hotkey.Key9,
	"SPACE": hotkey.KeySpace,
}

var modByName = map[string]hotkey.Modifier{
	"CMD":    hotkey.ModCmd,
	"CTRL":   hotkey.ModCtrl,
	"SHIFT":  hotkey.ModShift,
	"OPTION": hotkey.ModOption,
	"ALT":    hotkey.ModOption,
}

var modSymbol = map[string]string{
	"CMD": "⌘", "CTRL": "⌃", "SHIFT": "⇧", "OPTION": "⌥", "ALT": "⌥",
}

// HotkeyService registers global (system-wide) hotkeys that trigger a
// Runbook action. Assignments are in-memory only for now — they don't
// survive an app restart. Persistence is a deliberate follow-up, not
// built into this first pass.
type HotkeyService struct {
	mu       sync.Mutex
	handles  map[string]*hotkey.Hotkey
	bindings map[string]string
	runbook  *RunbookService
}

func NewHotkeyService(runbook *RunbookService) *HotkeyService {
	return &HotkeyService{
		handles:  make(map[string]*hotkey.Hotkey),
		bindings: make(map[string]string),
		runbook:  runbook,
	}
}

// Assign registers a global hotkey for the given action. mods is any
// combination of "cmd", "ctrl", "shift", "option"/"alt"; at least one is
// required so a bare letter never becomes a system-wide hotkey by accident.
// Returns the human-readable binding label (e.g. "⌘⇧M") on success.
func (h *HotkeyService) Assign(actionID string, mods []string, key string) (string, error) {
	if len(mods) == 0 {
		return "", fmt.Errorf("at least one modifier (cmd/ctrl/shift/option) is required")
	}

	k, ok := keyByName[strings.ToUpper(key)]
	if !ok {
		return "", fmt.Errorf("unsupported key: %s", key)
	}

	hkMods := make([]hotkey.Modifier, 0, len(mods))
	for _, m := range mods {
		mod, ok := modByName[strings.ToUpper(m)]
		if !ok {
			return "", fmt.Errorf("unsupported modifier: %s", m)
		}
		hkMods = append(hkMods, mod)
	}

	h.mu.Lock()
	if existing, ok := h.handles[actionID]; ok {
		existing.Unregister()
		delete(h.handles, actionID)
		delete(h.bindings, actionID)
	}
	h.mu.Unlock()

	hk := hotkey.New(hkMods, k)
	if err := hk.Register(); err != nil {
		return "", fmt.Errorf("this Mac hasn't granted Mill Accessibility permission yet (System Settings → Privacy & Security → Accessibility), or the combo is already taken by another app: %w", err)
	}

	label := formatBinding(mods, key)

	h.mu.Lock()
	h.handles[actionID] = hk
	h.bindings[actionID] = label
	h.mu.Unlock()

	go func() {
		for range hk.Keydown() {
			result, err := h.runbook.Run(actionID)
			if err != nil {
				continue
			}
			_ = copyToClipboard(result)
		}
	}()

	return label, nil
}

func (h *HotkeyService) Unassign(actionID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if hk, ok := h.handles[actionID]; ok {
		hk.Unregister()
		delete(h.handles, actionID)
		delete(h.bindings, actionID)
	}
}

func (h *HotkeyService) List() map[string]string {
	h.mu.Lock()
	defer h.mu.Unlock()
	out := make(map[string]string, len(h.bindings))
	for k, v := range h.bindings {
		out[k] = v
	}
	return out
}

func formatBinding(mods []string, key string) string {
	var b strings.Builder
	for _, m := range mods {
		b.WriteString(modSymbol[strings.ToUpper(m)])
	}
	b.WriteString(strings.ToUpper(key))
	return b.String()
}

func copyToClipboard(text string) error {
	cmd := exec.Command("pbcopy")
	cmd.Stdin = strings.NewReader(text)
	return cmd.Run()
}
