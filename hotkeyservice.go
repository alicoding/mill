package main

import (
	"errors"
	"fmt"
	"strings"
	"sync"

	"github.com/alicoding/mill/internal/adapters/clipboard"
	"github.com/alicoding/mill/internal/adapters/hotkey"
)

var modSymbol = map[string]string{
	"CMD": "⌘", "CTRL": "⌃", "SHIFT": "⇧", "OPTION": "⌥", "ALT": "⌥",
}

// HotkeyService registers global (system-wide) hotkeys that trigger a
// Runbook action. Assignments are in-memory only for now — they don't
// survive an app restart. Persistence is a deliberate follow-up, not
// built into this first pass.
type HotkeyService struct {
	mu       sync.Mutex
	bindings map[string]*hotkey.Binding
	labels   map[string]string
	runbook  *RunbookService
}

func NewHotkeyService(runbook *RunbookService) *HotkeyService {
	return &HotkeyService{
		bindings: make(map[string]*hotkey.Binding),
		labels:   make(map[string]string),
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

	h.mu.Lock()
	if existing, ok := h.bindings[actionID]; ok {
		_ = existing.Unbind()
		delete(h.bindings, actionID)
		delete(h.labels, actionID)
	}
	h.mu.Unlock()

	b, err := hotkey.Bind(mods, key)
	if err != nil {
		if errors.Is(err, hotkey.ErrRegisterFailed) {
			return "", fmt.Errorf("this Mac hasn't granted Mill Accessibility permission yet (System Settings → Privacy & Security → Accessibility), or the combo is already taken by another app: %w", err)
		}
		return "", err
	}

	label := formatBinding(mods, key)

	h.mu.Lock()
	h.bindings[actionID] = b
	h.labels[actionID] = label
	h.mu.Unlock()

	go func() {
		for range b.Keydown() {
			result, err := h.runbook.Run(actionID)
			if err != nil {
				continue
			}
			_ = clipboard.WriteText(result)
		}
	}()

	return label, nil
}

func (h *HotkeyService) Unassign(actionID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if b, ok := h.bindings[actionID]; ok {
		_ = b.Unbind()
		delete(h.bindings, actionID)
		delete(h.labels, actionID)
	}
}

func (h *HotkeyService) List() map[string]string {
	h.mu.Lock()
	defer h.mu.Unlock()
	out := make(map[string]string, len(h.labels))
	for k, v := range h.labels {
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
