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
