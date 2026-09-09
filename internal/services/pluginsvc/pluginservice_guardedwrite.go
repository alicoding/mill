package pluginsvc

import (
	"context"
	"fmt"

	"github.com/alicoding/mill/internal/domain/guardrail"
)

// guardedWriteKinds is the fixed, small allowlist this inline-ask door
// evaluates (goal 0374's Write-UX decisions): never a generic
// replacement for requestGuardedAction's own blocking/Review-queue
// door -- every other capability (edit-card-fields, write-content,
// open-url, net.fetch) keeps using that one, unchanged. A kind outside
// this set refuses outright, so this door can never become a second
// generic guarded-action mechanism by accident.
var guardedWriteKinds = map[string]bool{
	"external.comment":    true,
	"external.transition": true,
}

// guardedWriteOperations maps each named write kind to the operation
// its Integration entity must declare -- a FIXED mapping for these two
// named kinds only (goal 0374's own contract, not a generic per-plugin
// routing config the Gap explicitly warned against inventing): the
// bundled mill-live-view plugin's seeded Integration declares exactly
// these two paths in its own OpenAPI spec.
var guardedWriteOperations = map[string]struct{ path, method string }{
	"external.comment":    {path: "/items/{itemKey}/comments", method: "POST"},
	"external.transition": {path: "/items/{itemKey}/transitions", method: "POST"},
}

// guardedWriteAttributeAllowlist is, per kind, the ONLY attribute keys
// a caller may set (goal 0374's item 2 payload shapes) -- an unlisted
// key refuses before the guardrail is ever consulted, the same
// fail-closed shape audit.AllowedAttributes already uses for the audit
// row itself: both integrationId/itemKey are common routing keys, the
// third is each kind's own payload field.
var guardedWriteAttributeAllowlist = map[string][]string{
	"external.comment":    {"integrationId", "itemKey", "body"},
	"external.transition": {"integrationId", "itemKey", "toStatus"},
}

// validateGuardedWriteAttributes rejects any attribute key kind's own
// allowlist doesn't name.
func validateGuardedWriteAttributes(kind string, attributes map[string]string) error {
	allowed := guardedWriteAttributeAllowlist[kind]
	for key := range attributes {
		known := false
		for _, k := range allowed {
			known = known || k == key
		}
		if !known {
			return fmt.Errorf("%q: attribute %q is not in this kind's own allowlist", kind, key)
		}
	}
	return nil
}

// GuardedActionEvaluation is the read-only "what would happen" answer
// (goal 0374's Write-UX decision 1): no side effect, no park, nothing
// recorded -- the frame's OWN informational call, never authoritative.
// PerformGuardedActionForPlugin re-evaluates independently before
// ever performing anything.
type GuardedActionEvaluation struct {
	Effect    string
	RuleLabel string
}

// EvaluateGuardedActionForPlugin answers what a kind/attributes pair
// would do right now, without performing or recording anything -- lets
// the frame drive its own local Composing/Sending state before ever
// asking Mill to actually send.
func (p *PluginService) EvaluateGuardedActionForPlugin(pluginID, kind string, attributes map[string]string) (GuardedActionEvaluation, error) {
	plugin := p.resolvePlugin(pluginID)
	if plugin.Error != "" {
		return GuardedActionEvaluation{}, fmt.Errorf("plugin %q: %s", pluginID, plugin.Error)
	}
	if err := p.checkGuardedWriteDoor(pluginID, plugin, kind, attributes); err != nil {
		return GuardedActionEvaluation{}, err
	}
	verdict := p.guardrail.EvaluateAction(kind, pluginActorAttributes(pluginID, plugin, attributes), guardrail.ClassExternal)
	return GuardedActionEvaluation{Effect: string(verdict.Effect), RuleLabel: verdict.RuleLabel}, nil
}

// PluginGuardedActionResult is PerformGuardedActionForPlugin's outcome
// -- the same shape requestGuardedAction's existing GuardedActionResult
// already carries on the frontend, so the two doors read alike there.
type PluginGuardedActionResult struct {
	Approved  bool
	Effect    string
	RuleLabel string
	Performed bool
}

// PerformGuardedActionForPlugin is the ONLY caller allowed to set
// confirmed=true, and it is never reachable from a plugin frame: the
// frame-facing bridge method carries no such parameter on the wire
// (frontend/src/app/pluginFrameBridge.ts's FRAME_METHODS never lists
// this door at all), so confirmed only ever arrives from PluginFrame.tsx's
// OWN click handler on the banner Mill's chrome renders, outside the
// sandboxed frame (goal 0374 amendment 1). No shared pending record is
// ever created: an "ask" outcome with confirmed=false returns
// immediately, unaudited (nothing was attempted, nothing for another
// actor to see or resolve); the SAME call again with confirmed=true is
// the human's decision, audited as such. The generic
// guardrailsvc.ResolveGuardedAction door is never involved.
func (p *PluginService) PerformGuardedActionForPlugin(pluginID, kind string, attributes map[string]string, description string, confirmed bool) (PluginGuardedActionResult, error) {
	plugin := p.resolvePlugin(pluginID)
	if plugin.Error != "" {
		return PluginGuardedActionResult{}, fmt.Errorf("plugin %q: %s", pluginID, plugin.Error)
	}
	if err := p.checkGuardedWriteDoor(pluginID, plugin, kind, attributes); err != nil {
		return PluginGuardedActionResult{}, err
	}
	itemKey, integrationID := attributes["itemKey"], attributes["integrationId"]
	verdict := p.guardrail.EvaluateAction(kind, pluginActorAttributes(pluginID, plugin, attributes), guardrail.ClassExternal)
	ctx := context.Background()
	switch verdict.Effect {
	case guardrail.EffectDeny:
		p.recordGuardedAction(ctx, pluginID, plugin, kind, itemKey, integrationID, "deny", verdict.RuleLabel, "")
		return PluginGuardedActionResult{Effect: string(verdict.Effect), RuleLabel: verdict.RuleLabel}, nil
	case guardrail.EffectAllow:
		return p.performGuardedWrite(ctx, pluginID, plugin, kind, attributes, "allow", string(verdict.Effect), verdict.RuleLabel)
	default: // guardrail.EffectAsk
		if !confirmed {
			return PluginGuardedActionResult{Effect: string(verdict.Effect), RuleLabel: verdict.RuleLabel}, nil
		}
		return p.performGuardedWrite(ctx, pluginID, plugin, kind, attributes, "ask -- confirmed inline by the user", string(verdict.Effect), verdict.RuleLabel)
	}
}

// checkGuardedWriteDoor is the fail-closed pre-check every entry point
// above shares: an unknown kind, an unlisted attribute key, an
// undeclared capability, or no guardrail wired all refuse before any
// rule is ever consulted.
func (p *PluginService) checkGuardedWriteDoor(pluginID string, plugin PluginInfo, kind string, attributes map[string]string) error {
	if !guardedWriteKinds[kind] {
		return fmt.Errorf("plugin %q: %q is not an inline-confirmable guarded action kind", pluginID, kind)
	}
	if err := validateGuardedWriteAttributes(kind, attributes); err != nil {
		return fmt.Errorf("plugin %q: %w", pluginID, err)
	}
	if !hasCapability(plugin.Manifest, "call-integration") {
		return fmt.Errorf("plugin %q does not declare the \"call-integration\" capability in its manifest", pluginID)
	}
	if p.guardrail == nil {
		return fmt.Errorf("guardrail unavailable: a plugin write is always guarded")
	}
	return nil
}

// performGuardedWrite executes the real write against the named
// Integration and records the outcome, whatever it is -- Performed is
// true only once the side effect actually completed.
func (p *PluginService) performGuardedWrite(ctx context.Context, pluginID string, plugin PluginInfo, kind string, attributes map[string]string, outcome, effect, ruleLabel string) (PluginGuardedActionResult, error) {
	itemKey, integrationID := attributes["itemKey"], attributes["integrationId"]
	if p.integrations == nil {
		p.recordGuardedAction(ctx, pluginID, plugin, kind, itemKey, integrationID, outcome, ruleLabel, "Integrations are not available in this mode")
		return PluginGuardedActionResult{}, fmt.Errorf("plugin %q: Integrations are not available in this mode", pluginID)
	}
	op := guardedWriteOperations[kind]
	if _, err := p.integrations(integrationID, op.path, op.method, attributes); err != nil {
		p.recordGuardedAction(ctx, pluginID, plugin, kind, itemKey, integrationID, outcome, ruleLabel, err.Error())
		return PluginGuardedActionResult{Approved: true, Effect: effect, RuleLabel: ruleLabel}, err
	}
	p.recordGuardedAction(ctx, pluginID, plugin, kind, itemKey, integrationID, outcome, ruleLabel, "")
	return PluginGuardedActionResult{Approved: true, Effect: effect, RuleLabel: ruleLabel, Performed: true}, nil
}
