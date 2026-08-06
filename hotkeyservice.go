package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"

	"github.com/alicoding/mill/internal/adapters/hotkey"
	"github.com/alicoding/mill/internal/adapters/settings"
	"github.com/wailsapp/wails/v3/pkg/application"
)

var modSymbol = map[string]string{
	"CMD": "⌘", "CTRL": "⌃", "SHIFT": "⇧", "OPTION": "⌥", "ALT": "⌥",
}

// hotkeyBindingsKey is the single settings-store key holding every
// assignment as one JSON blob (map[actionID]persistedBinding) rather than
// one store key per action -- there are only ever a handful of Runbook
// actions, and one key means one atomic read/write instead of needing to
// separately track which per-action keys exist.
const hotkeyBindingsKey = "hotkey-bindings"

// persistedBinding is the raw (mods, key) pair Assign was originally
// called with -- not the human-readable label ("⌘⇧M"), which can't be
// parsed back into modifier/key names to re-register the OS hotkey on the
// next launch.
type persistedBinding struct {
	Mods []string `json:"mods"`
	Key  string   `json:"key"`
}

// HotkeyService registers global (system-wide) hotkeys that trigger a
// Runbook action. Assignments persist across restarts via the settings
// store (see RestoreBindings) -- see docs/SPEC.md §2.2.
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
	raw      map[string]persistedBinding
	runbook  *RunbookService
	logger   *slog.Logger
	store    settings.Store
}

func NewHotkeyService(runbook *RunbookService, logger *slog.Logger, store settings.Store) *HotkeyService {
	return &HotkeyService{
		bindings: make(map[string]*hotkey.Binding),
		labels:   make(map[string]string),
		raw:      make(map[string]persistedBinding),
		runbook:  runbook,
		logger:   logger,
		store:    store,
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
		delete(h.raw, actionID)
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
	h.raw[actionID] = persistedBinding{Mods: mods, Key: key}
	h.mu.Unlock()

	h.logger.Info("hotkey registered", "action", actionID, "binding", label)
	h.persist()

	go func() {
		for range b.Keydown() {
			h.logger.Info("hotkey fired", "action", actionID, "binding", label)
			result, err := h.runbook.Run(actionID)
			if err != nil {
				h.logger.Error("hotkey action failed", "action", actionID, "binding", label, "error", err)
				emitHotkeyActivity(actionID, label, false, err.Error(), "")
				continue
			}
			// No clipboard write here: each action owns writing its own
			// result to the clipboard as part of its own Apply step (see
			// internal/domain/runbook). A blanket clipboard.WriteText(result)
			// here used to unconditionally overwrite whatever an action had
			// already written -- e.g. load-sample-html writes real HTML,
			// then had its own UI-facing status string immediately clobber
			// it. Real bug, not hypothetical: hit it live.
			h.logger.Info("hotkey action completed", "action", actionID, "binding", label, "output_bytes", len(result))
			emitHotkeyActivity(actionID, label, true, fmt.Sprintf("completed (%d bytes)", len(result)), result)
		}
	}()

	return label, nil
}

func (h *HotkeyService) Unassign(actionID string) {
	h.mu.Lock()
	b, ok := h.bindings[actionID]
	if ok {
		_ = b.Unbind()
		delete(h.bindings, actionID)
		delete(h.labels, actionID)
		delete(h.raw, actionID)
	}
	h.mu.Unlock()

	// persist() takes its own lock -- must not be called while h.mu is
	// still held above, or it deadlocks (sync.Mutex isn't reentrant).
	if ok {
		h.logger.Info("hotkey unassigned", "action", actionID)
		h.persist()
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

// persist writes every current assignment to the settings store as one
// JSON blob. Called after every successful Assign/Unassign; failures are
// logged, not returned -- a persistence hiccup shouldn't make the hotkey
// assignment the user just made in the UI appear to fail, it just won't
// survive the next restart.
func (h *HotkeyService) persist() {
	h.mu.Lock()
	raw := make(map[string]persistedBinding, len(h.raw))
	for k, v := range h.raw {
		raw[k] = v
	}
	h.mu.Unlock()

	data, err := json.Marshal(raw)
	if err != nil {
		h.logger.Error("failed to marshal hotkey bindings for persistence", "error", err)
		return
	}
	if err := h.store.Set(hotkeyBindingsKey, string(data)); err != nil {
		h.logger.Error("failed to persist hotkey bindings", "error", err)
	}
}

// RestoreBindings re-registers every previously persisted assignment. It
// must run only after the app's native run loop is actually spinning
// (macOS/Windows/Linux all require this for global hotkey registration --
// see docs/SPEC.md §2.2's note on the golang-design/hotkey Fyne example),
// which is well after ServiceStartup: main.go calls this from the
// events.Common.ApplicationStarted hook, not from init/ServiceStartup.
// Individual restore failures (e.g. Accessibility permission revoked
// since the last run) are logged and skipped, not fatal to the others.
//
// wails:ignore -- Go-internal startup step only, called once from
// main.go. Not something the frontend has any legitimate reason to
// trigger, so it's excluded from the generated JS bindings entirely
// rather than left reachable and just unused (same pattern Wails' own
// KVStoreService uses for its Configure method).
//
//wails:ignore
func (h *HotkeyService) RestoreBindings() {
	raw, ok := h.store.Get(hotkeyBindingsKey).(string)
	if !ok || raw == "" {
		return
	}

	var persisted map[string]persistedBinding
	if err := json.Unmarshal([]byte(raw), &persisted); err != nil {
		h.logger.Error("failed to unmarshal persisted hotkey bindings", "error", err)
		return
	}

	for actionID, pb := range persisted {
		if _, err := h.Assign(actionID, pb.Mods, pb.Key); err != nil {
			h.logger.Error("failed to restore hotkey binding", "action", actionID, "error", err)
		}
	}
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
func emitHotkeyActivity(actionID, binding string, success bool, detail, result string) {
	application.Get().Event.Emit("hotkey-activity", HotkeyActivity{
		ActionID: actionID,
		Binding:  binding,
		Success:  success,
		Detail:   detail,
		Result:   result,
	})
}
