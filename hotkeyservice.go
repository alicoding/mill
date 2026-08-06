package main

import (
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"

	"github.com/alicoding/mill/internal/adapters/clipboard"
	"github.com/alicoding/mill/internal/adapters/hotkey"
	"github.com/wailsapp/wails/v3/pkg/application"
)

var modSymbol = map[string]string{
	"CMD": "⌘", "CTRL": "⌃", "SHIFT": "⇧", "OPTION": "⌥", "ALT": "⌥",
}

// HotkeyService registers global (system-wide) hotkeys that trigger a
// Runbook action. Assignments are in-memory only for now — they don't
// survive an app restart. Persistence is a deliberate follow-up, not
// built into this first pass.
//
// The fire path (OS delivers a keypress -> action runs -> clipboard is
// written) has no UI surface at all, unlike the Run button's inline
// success/error rendering — a hotkey that's registered but never fires
// (e.g. the combo is already claimed by another app, or macOS just never
// delivers it) is otherwise silent and undebuggable. logger makes every
// stage of that path visible instead of guessing.
type HotkeyService struct {
	mu       sync.Mutex
	bindings map[string]*hotkey.Binding
	labels   map[string]string
	runbook  *RunbookService
	logger   *slog.Logger
}

func NewHotkeyService(runbook *RunbookService, logger *slog.Logger) *HotkeyService {
	return &HotkeyService{
		bindings: make(map[string]*hotkey.Binding),
		labels:   make(map[string]string),
		runbook:  runbook,
		logger:   logger,
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

	h.logger.Info("hotkey registered", "action", actionID, "binding", label)

	go func() {
		for range b.Keydown() {
			h.logger.Info("hotkey fired", "action", actionID, "binding", label)
			result, err := h.runbook.Run(actionID)
			if err != nil {
				h.logger.Error("hotkey action failed", "action", actionID, "binding", label, "error", err)
				emitHotkeyActivity(actionID, label, false, err.Error())
				continue
			}
			if err := clipboard.WriteText(result); err != nil {
				h.logger.Error("hotkey result clipboard write failed", "action", actionID, "binding", label, "error", err)
				emitHotkeyActivity(actionID, label, false, "clipboard write failed: "+err.Error())
				continue
			}
			h.logger.Info("hotkey action completed", "action", actionID, "binding", label, "output_bytes", len(result))
			emitHotkeyActivity(actionID, label, true, fmt.Sprintf("copied to clipboard (%d bytes)", len(result)))
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
		h.logger.Info("hotkey unassigned", "action", actionID)
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

// emitHotkeyActivity pushes a HotkeyActivity event to the frontend so a
// fired hotkey's outcome is visible in the app itself, not just in the
// slog lines above (terminal-only, and only during `task dev`).
// application.Get() is safe to call here: this only ever runs from the
// Keydown() goroutine, which can't fire before application.New has run
// and registered the global app instance.
func emitHotkeyActivity(actionID, binding string, success bool, detail string) {
	application.Get().Event.Emit("hotkey-activity", HotkeyActivity{
		ActionID: actionID,
		Binding:  binding,
		Success:  success,
		Detail:   detail,
	})
}
