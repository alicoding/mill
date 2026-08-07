// Package trigger holds the core-domain logic around a workflow's
// Trigger node -- which node is it, and (for hotkeys specifically) the
// one-combo-per-workflow exclusivity rule (SPEC.md §3.4, modeled on
// Raycast's own conflict UX). Per CLAUDE.md's core-domain rule, this
// stays hand-written: no library has an opinion on Mill's own trigger
// semantics. The actual live listeners (OS hotkey registration, cron,
// clipboard polling, filesystem watching) are commodity adapters
// (internal/adapters/*), called directly by TriggerService
// (triggerservice.go) -- not routed through interfaces here, since
// there's exactly one real implementation of each today and no swapping
// need yet; introducing ports without a second implementation to justify
// them would be speculative, not the CLAUDE.md ports/adapters rule this
// otherwise follows.
package trigger

import (
	"sort"
	"strings"

	"github.com/alicoding/mill/internal/domain/composition"
)

// ExtractTrigger finds a workflow's root trigger node, if it has one. A
// workflow's root is the node no edge points at -- the same definition
// composition.linearOrder uses internally, re-derived here since that
// function is unexported and this package only needs the one fact
// (which trigger, with what config), not a full execution-order walk.
func ExtractTrigger(wf composition.Workflow) (nodeTypeID string, config map[string]string, ok bool) {
	hasIncoming := make(map[string]bool, len(wf.Edges))
	for _, e := range wf.Edges {
		hasIncoming[e.Target] = true
	}
	for _, n := range wf.Nodes {
		if !hasIncoming[n.ID] && n.Kind == composition.KindTrigger {
			return n.NodeTypeID, n.Config, true
		}
	}
	return "", nil, false
}

// HotkeyBinding is one workflow's registered hotkey combo -- the unit
// CheckConflict compares against.
type HotkeyBinding struct {
	WorkflowID string
	Mods       []string
	Key        string
}

// comboKey normalizes a (mods, key) pair into a stable, order-
// independent string so "cmd+shift+M" and "shift+cmd+M" collide as the
// same combo rather than silently coexisting as different keys.
func comboKey(mods []string, key string) string {
	sorted := make([]string, len(mods))
	copy(sorted, mods)
	sort.Strings(sorted)
	return strings.ToUpper(strings.Join(sorted, "+") + "+" + key)
}

// CheckConflict returns the workflow ID already holding the (mods, key)
// combo, if any workflow other than excludeWorkflowID holds it. This is
// SPEC.md §3.4's "one combo, one workflow" rule: the caller is expected
// to surface conflictWorkflowID and offer "use anyway" (unassign the
// other workflow first, then retry) or "pick another," not silently
// double-register both.
func CheckConflict(existing []HotkeyBinding, mods []string, key string, excludeWorkflowID string) (conflictWorkflowID string, found bool) {
	want := comboKey(mods, key)
	for _, b := range existing {
		if b.WorkflowID == excludeWorkflowID {
			continue
		}
		if comboKey(b.Mods, b.Key) == want {
			return b.WorkflowID, true
		}
	}
	return "", false
}
