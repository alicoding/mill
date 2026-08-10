package composition

import (
	"strings"
	"testing"
)

// Ruleset validation (docs/adr/0023): all-pass lets the payload
// through unchanged; any failing or unevaluable rule fails the step
// naming the culprits.
func TestRuleset_PassAndFail(t *testing.T) {
	nodes := []Node{
		{ID: "t", NodeTypeID: "trigger-manual"},
		{ID: "r", NodeTypeID: "ruleset", Config: map[string]string{
			"rulesJSON": `[{"name":"amount below limit","condition":"Attributes[\"amount\"] < 100"},{"name":"payload not empty","condition":"Payload != \"\""}]`,
		}},
	}
	edges := []Edge{{ID: "e", Source: "t", Target: "r"}}
	attrs := []AttributeDef{{Key: "amount", Label: "Amount", Type: FieldNumber}}

	resolved, err := ResolveNodeDefaults(nodes)
	if err != nil {
		t.Fatalf("ResolveNodeDefaults: %v", err)
	}

	// Passing case: amount 5, non-empty payload seeded by... payload
	// starts empty on a manual trigger, so "payload not empty" fails --
	// use only the amount rule for the pass case.
	passNodes := []Node{
		resolved[0],
		{ID: "r", Kind: KindProcess, NodeTypeID: "ruleset", Config: map[string]string{
			"rulesJSON": `[{"name":"amount below limit","condition":"Attributes[\"amount\"] < 100"}]`,
		}},
	}
	out, err := ExecuteWorkflow(passNodes, edges, attrs, ExecuteOptions{AttrValues: map[string]string{"amount": "5"}})
	if err != nil {
		t.Fatalf("all-pass ruleset errored: %v", err)
	}
	_ = out

	// Failing case: amount over the limit, plus the empty-payload rule.
	_, err = ExecuteWorkflow(resolved, edges, attrs, ExecuteOptions{AttrValues: map[string]string{"amount": "500"}})
	if err == nil {
		t.Fatal("failing ruleset did not error")
	}
	if !strings.Contains(err.Error(), "amount below limit") || !strings.Contains(err.Error(), "payload not empty") {
		t.Fatalf("error should name both failed rules, got: %v", err)
	}

	// An unevaluable condition counts as failed (fail-safe).
	badNodes := []Node{
		resolved[0],
		{ID: "r", Kind: KindProcess, NodeTypeID: "ruleset", Config: map[string]string{
			"rulesJSON": `[{"name":"broken","condition":"NoSuchVar > 1"}]`,
		}},
	}
	_, err = ExecuteWorkflow(badNodes, edges, attrs)
	if err == nil || !strings.Contains(err.Error(), "broken") {
		t.Fatalf("unevaluable rule must fail safe naming the rule, got: %v", err)
	}
}
