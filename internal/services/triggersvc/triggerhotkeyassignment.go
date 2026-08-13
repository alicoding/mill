package triggersvc

import (
	"errors"
	"fmt"

	"github.com/alicoding/mill/internal/adapters/hotkey"
	"github.com/alicoding/mill/internal/domain/trigger"
)

// Split out of triggerservice.go once that file crossed the 500-line
// convention (CLAUDE.md/.claude/rules/architecture.md) -- the
// hotkey-assignment cluster (Assign/Unassign/List/ClaimedCombos/
// SetReservedCombo, plus AssignHotkey's own TOCTOU re-check,
// docs/goals/0025 item 5) is self-contained enough to be its own file,
// same "split along a real seam" shape triggerservice.go's own doc
// comments already describe for other packages. No behavior change --
// every method here is still on *TriggerService, still guarded by the
// same s.mu the rest of the service uses.

// AssignHotkey binds workflowID to (mods, key). Rejects the assignment
// if a different workflow already holds that exact combo (SPEC.md
// §3.4's exclusivity rule) instead of silently letting both fire on the
// same keypress -- the frontend surfaces the conflict and the owning
// workflow's name, offering "pick another" (the common path) or
// explicitly unassigning the other workflow first to steal it, matching
// Raycast's own real conflict UX.
func (s *TriggerService) AssignHotkey(workflowID string, mods []string, key string) (string, error) {
	if len(mods) == 0 {
		return "", fmt.Errorf("at least one modifier (cmd/ctrl/shift/option) is required")
	}

	s.mu.Lock()
	existing := make([]trigger.HotkeyBinding, 0, len(s.hkRaw))
	for id, hk := range s.hkRaw {
		existing = append(existing, trigger.HotkeyBinding{WorkflowID: id, Mods: hk.Mods, Key: hk.Key})
	}
	reserved := s.reserved
	s.mu.Unlock()

	if conflictID, found := trigger.CheckConflict(existing, mods, key, workflowID); found {
		label := conflictID
		if wf, ok := s.FindWorkflow(conflictID); ok {
			label = wf.Label
		}
		return "", fmt.Errorf("this combo is already bound to %q -- pick another, or unassign it there first", label)
	}
	// Also check against the app-level summon hotkey (settingsservice.go),
	// which lives outside this service's own per-workflow hkRaw map --
	// wired in from main.go via SetReservedCombo once SettingsService
	// exists, same "injected function var" seam as SetHTTPRequestLookup.
	if reserved != nil {
		if rMods, rKey, ok := reserved(); ok {
			candidate := []trigger.HotkeyBinding{{WorkflowID: "summon", Mods: rMods, Key: rKey}}
			if _, found := trigger.CheckConflict(candidate, mods, key, ""); found {
				return "", fmt.Errorf("this combo is already bound to Mill's own \"summon the app\" shortcut (Settings) -- pick another, or change that first")
			}
		}
	}

	// Validate the combo actually registers (permission granted, not
	// already claimed by another app) before persisting it. Only a
	// probe: Sync below does the real, tracked registration, so this is
	// unbound again once the re-check below has run.
	probe, err := hotkey.Bind(mods, key)
	if err != nil {
		if errors.Is(err, hotkey.ErrRegisterFailed) {
			return "", fmt.Errorf("this Mac hasn't granted Mill Accessibility permission yet (System Settings → Privacy & Security → Accessibility), or the combo is already taken by another app: %w", err)
		}
		return "", err
	}

	// TOCTOU re-check (docs/goals/0025 item 5): everything above
	// (CheckConflict, the reserved-combo check, hotkey.Bind's own OS
	// probe) ran without holding s.mu, so a second, concurrent
	// AssignHotkey call for a DIFFERENT workflow could have raced in
	// between and already claimed this exact combo -- both calls would
	// see "no conflict" against the s.hkRaw snapshot each one read
	// before either wrote anything. finalizeHotkeyAssignment re-runs
	// CheckConflict against the CURRENT s.hkRaw under the same lock the
	// write uses, closing that window: the last writer to actually
	// reach this point wins the check-then-write atomically, and the
	// loser gets the same conflict error it would have gotten had it
	// simply lost the race to go first. Split into its own method (not
	// inlined here) so this exact re-check is directly unit-testable
	// without a real OS hotkey.Bind call, which can't run headless
	// (see triggerservice_test.go's own header comment) -- a live
	// two-goroutine race through the full public AssignHotkey can't be
	// exercised in this repo's CI for the same reason.
	label, err := s.finalizeHotkeyAssignment(workflowID, mods, key)
	_ = probe.Unbind()
	if err != nil {
		return "", err
	}

	s.persistHotkeys()
	s.logger.Info("trigger hotkey assigned", "workflow", workflowID, "binding", label)

	s.Sync(s.comp.Workflows())

	return label, nil
}

// finalizeHotkeyAssignment re-checks for a conflict against the CURRENT
// s.hkRaw under s.mu and, if none is found, records workflowID's
// binding -- see AssignHotkey's own call site for the full TOCTOU
// window this closes (docs/goals/0025 item 5). Exported at the
// unexported level (not public API) purely so the re-check itself is
// directly unit-testable: a test can seed a conflicting s.hkRaw entry
// and call this method straight, without needing a real OS
// hotkey.Bind() to succeed first (which can't run headless).
func (s *TriggerService) finalizeHotkeyAssignment(workflowID string, mods []string, key string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	current := make([]trigger.HotkeyBinding, 0, len(s.hkRaw))
	for id, hk := range s.hkRaw {
		current = append(current, trigger.HotkeyBinding{WorkflowID: id, Mods: hk.Mods, Key: hk.Key})
	}
	if conflictID, found := trigger.CheckConflict(current, mods, key, workflowID); found {
		label := conflictID
		if wf, ok := s.FindWorkflow(conflictID); ok {
			label = wf.Label
		}
		return "", fmt.Errorf("this combo is already bound to %q -- pick another, or unassign it there first", label)
	}
	s.hkRaw[workflowID] = PersistedHotkey{Mods: mods, Key: key}
	return FormatBinding(mods, key), nil
}

// UnassignHotkey removes workflowID's hotkey binding, if it has one.
func (s *TriggerService) UnassignHotkey(workflowID string) {
	s.mu.Lock()
	_, existed := s.hkRaw[workflowID]
	delete(s.hkRaw, workflowID)
	s.mu.Unlock()

	if !existed {
		return
	}
	s.persistHotkeys()
	s.logger.Info("trigger hotkey unassigned", "workflow", workflowID)
	s.Sync(s.comp.Workflows())
}

// DebugAssignHotkey records workflowID's combo directly, skipping the
// real hotkey.Bind OS probe AssignHotkey requires -- global hotkey
// registration cannot succeed outside a native run loop (hotkey_server.go's
// Bind always errors), so e2e coverage of anything downstream of an
// assigned combo needs an entry point that doesn't depend on a real OS
// bind. Still runs the same TOCTOU-safe conflict check AssignHotkey does
// (finalizeHotkeyAssignment), just without the probe or the reserved-
// summon-hotkey cross-check. Exported for settingssvc's isolated-data-
// gated debug RPC only, never a frontend RPC directly -- same
// //wails:ignore shape FindWorkflow already uses for the same reason.
//
//wails:ignore
func (s *TriggerService) DebugAssignHotkey(workflowID string, mods []string, key string) (string, error) {
	if len(mods) == 0 {
		return "", fmt.Errorf("at least one modifier (cmd/ctrl/shift/option) is required")
	}
	label, err := s.finalizeHotkeyAssignment(workflowID, mods, key)
	if err != nil {
		return "", err
	}
	s.persistHotkeys()
	s.logger.Info("trigger hotkey debug-assigned", "workflow", workflowID, "binding", label)
	s.Sync(s.comp.Workflows())
	return label, nil
}

// ListHotkeys returns every workflow ID with an assigned hotkey, mapped
// to its human-readable binding label (e.g. "⌘⇧M").
func (s *TriggerService) ListHotkeys() map[string]string {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make(map[string]string, len(s.hkRaw))
	for id, hk := range s.hkRaw {
		out[id] = FormatBinding(hk.Mods, hk.Key)
	}
	return out
}

// ClaimedCombos returns every currently-assigned per-workflow hotkey
// binding, in trigger.HotkeyBinding shape -- the seam settingsservice.go
// uses to check a new summon-hotkey assignment against every existing
// per-workflow binding (the reverse direction of the reserved-combo
// check AssignHotkey already does above).
func (s *TriggerService) ClaimedCombos() []trigger.HotkeyBinding {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]trigger.HotkeyBinding, 0, len(s.hkRaw))
	for id, hk := range s.hkRaw {
		out = append(out, trigger.HotkeyBinding{WorkflowID: id, Mods: hk.Mods, Key: hk.Key})
	}
	return out
}

// SetReservedCombo wires the function AssignHotkey checks in addition to
// per-workflow bindings, so a workflow hotkey can't silently collide
// with Mill's own app-level summon hotkey (settingsservice.go). Called
// once from main.go once SettingsService exists -- same "injected
// function var, wired after both services are constructed" shape as
// CompositionService.SetSyncer.
//
//wails:ignore
func (s *TriggerService) SetReservedCombo(fn func() (mods []string, key string, ok bool)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.reserved = fn
}
