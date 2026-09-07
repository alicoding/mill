package guardrailsvc

import (
	"testing"

	"github.com/alicoding/mill/internal/domain/guardrail"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// TestGuardrailService_FreshInstall_SeedsBuiltInRule proves
// reconcileBuiltInRules' own top-up (goal 0203 S2, guardrailservice_
// builtin.go): a brand-new store's GuardrailService already carries the
// seeded "Uses a stored secret" rule, no separate authoring step
// needed -- same fresh-install contract every other Configure-entity
// constructor already gives (TestConfigureService_FreshInstall_
// SeedsBuiltInRequests et al.).
func TestGuardrailService_FreshInstall_SeedsBuiltInRule(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	g := NewGuardrailService(store, comp)

	rules := g.Rules()
	if len(rules) != len(guardrail.BuiltIn()) {
		t.Fatalf("Rules() on a fresh install = %d entries, want %d (guardrail.BuiltIn())", len(rules), len(guardrail.BuiltIn()))
	}
	var found *guardrail.Rule
	for i := range rules {
		if rules[i].ID == guardrail.ExampleSecretGuardRuleID {
			found = &rules[i]
		}
	}
	if found == nil {
		t.Fatalf("Rules() on a fresh install has no %q, want the seeded example present", guardrail.ExampleSecretGuardRuleID)
	}
	if !found.BuiltIn || found.Effect != guardrail.EffectAsk || found.Condition == "" {
		t.Errorf("seeded rule = %+v, want BuiltIn=true, Effect=ask, a non-empty Condition", *found)
	}
}

// TestGuardrailService_DeletingTheBuiltInRule_DoesNotReturnOnRestart
// proves DeleteRule's own tombstone-on-built-in path (mirroring
// DeleteExecEnv/DeleteMCPServer): a deliberately deleted seeded rule
// must stay deleted across a restart, not silently reappear via
// reconcile's own top-up.
func TestGuardrailService_DeletingTheBuiltInRule_DoesNotReturnOnRestart(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	g := NewGuardrailService(store, comp)

	if err := g.DeleteRule(guardrail.ExampleSecretGuardRuleID); err != nil {
		t.Fatalf("DeleteRule: %v", err)
	}

	restarted := NewGuardrailService(store, comp)
	for _, r := range restarted.Rules() {
		if r.ID == guardrail.ExampleSecretGuardRuleID {
			t.Fatalf("deleted built-in rule %q reappeared after restart, want it to stay deleted", guardrail.ExampleSecretGuardRuleID)
		}
	}
	if len(restarted.Rules()) != len(guardrail.BuiltIn())-1 {
		t.Errorf("Rules() after restart = %d entries, want %d (one deleted, the rest persisted)", len(restarted.Rules()), len(guardrail.BuiltIn())-1)
	}
}

// ADR-0048: a plugin fetch carrying a secret parks by the seeded rule,
// and ask outranks a later allow rule for the same host; a fetch with
// no secret is untouched by it.
func TestBuiltIn_PluginFetchWithSecretAlwaysAsks(t *testing.T) {
	store := servicetest.NewFakeStore()
	g := NewGuardrailService(store, compositionsvc.NewCompositionService(store))
	if _, err := g.CreateRule(guardrail.Rule{ID: "allow-host", Label: "Allow api", Effect: guardrail.EffectAllow, NodeTypeID: "net.fetch", Condition: `Attributes.host == "api.example.com"`}); err != nil {
		t.Fatal(err)
	}
	with := g.EvaluateAction("net.fetch", map[string]string{"host": "api.example.com", "method": "GET", "secret": "Jira PAT"}, guardrail.ClassExternal)
	if with.Effect != guardrail.EffectAsk || with.RuleID != guardrail.PluginFetchSecretRuleID {
		t.Errorf("with secret: %+v, want ask by %s", with, guardrail.PluginFetchSecretRuleID)
	}
	without := g.EvaluateAction("net.fetch", map[string]string{"host": "api.example.com", "method": "GET"}, guardrail.ClassExternal)
	if without.Effect != guardrail.EffectAllow || without.RuleLabel != "Allow api" {
		t.Errorf("without secret: %+v, want the host allow", without)
	}
}

// docs/goals/0357 S1b: the seeded allow rule decides on the ACTOR
// attribute, never by skipping evaluation -- a bundled plugin's
// card-field write is allowed, a third-party one still asks (the class
// default), and the rule stays a normal, deletable Rule record either
// way.
func TestBuiltIn_PluginEditCardFieldsAllowsOnlyBuiltInPlugins(t *testing.T) {
	store := servicetest.NewFakeStore()
	g := NewGuardrailService(store, compositionsvc.NewCompositionService(store))

	builtIn := g.EvaluateAction("card.set-fields", map[string]string{"plugin.id": "mill-roadmap", "plugin.builtin": "true", "cardId": "c1"}, guardrail.ClassExternal)
	if builtIn.Effect != guardrail.EffectAllow || builtIn.RuleID != guardrail.BuiltInPluginEditCardFieldsRuleID {
		t.Errorf("built-in plugin actor: %+v, want allow by %s", builtIn, guardrail.BuiltInPluginEditCardFieldsRuleID)
	}
	thirdParty := g.EvaluateAction("card.set-fields", map[string]string{"plugin.id": "some-vendor-plugin", "plugin.builtin": "false", "cardId": "c1"}, guardrail.ClassExternal)
	if thirdParty.Effect != guardrail.EffectAsk {
		t.Errorf("third-party plugin actor: %+v, want the ClassExternal ask default", thirdParty)
	}
	noActor := g.EvaluateAction("card.set-fields", map[string]string{"cardId": "c1"}, guardrail.ClassExternal)
	if noActor.Effect != guardrail.EffectAsk {
		t.Errorf("no actor attributes: %+v, want ask (a missing plugin.builtin fails the condition closed)", noActor)
	}
}

// Mirrors TestGuardrailService_DeletingTheBuiltInRule_DoesNotReturnOnRestart
// for the plugin card-fields allow rule specifically (docs/goals/0357
// S1b item 5): deleting it makes the built-in write ask again, and a
// restart's reconcile never resurrects it.
func TestGuardrailService_DeletingTheBuiltInPluginEditCardFieldsRule_DoesNotReturnOnRestart(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	g := NewGuardrailService(store, comp)

	if err := g.DeleteRule(guardrail.BuiltInPluginEditCardFieldsRuleID); err != nil {
		t.Fatalf("DeleteRule: %v", err)
	}
	afterDelete := g.EvaluateAction("card.set-fields", map[string]string{"plugin.id": "mill-roadmap", "plugin.builtin": "true"}, guardrail.ClassExternal)
	if afterDelete.Effect != guardrail.EffectAsk {
		t.Errorf("after deleting the seeded rule: %+v, want the built-in write to ask again", afterDelete)
	}

	restarted := NewGuardrailService(store, comp)
	for _, r := range restarted.Rules() {
		if r.ID == guardrail.BuiltInPluginEditCardFieldsRuleID {
			t.Fatalf("deleted built-in rule %q reappeared after restart, want it to stay deleted", guardrail.BuiltInPluginEditCardFieldsRuleID)
		}
	}
}
