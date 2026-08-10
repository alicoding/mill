package guardrail

import (
	"strings"
	"testing"
)

func step() Step {
	return Step{
		NodeTypeID: "integration-http",
		RequestID:  "req-1",
		WorkflowID: "wf-1",
		NodeID:     "node-1",
		Env:        ConditionEnv("hello", map[string]any{"amount": 5}, map[string]string{"method": "GET"}),
	}
}

func TestEvaluate_DefaultByEffectClass(t *testing.T) {
	if got := Evaluate(nil, step(), ClassExternal).Effect; got != EffectAsk {
		t.Fatalf("external default = %s, want ask", got)
	}
	for _, class := range []EffectClass{ClassNone, ClassRead, ClassLocal} {
		if got := Evaluate(nil, step(), class).Effect; got != EffectAllow {
			t.Fatalf("%s default = %s, want allow", class, got)
		}
	}
}

func TestEvaluate_DenyBeatsAskBeatsAllow_RegardlessOfScopeBreadth(t *testing.T) {
	// A narrow instance-scoped allow must not punch a hole in a broad
	// node-type deny (ADR-0019's categorical deny-first precedence).
	rules := []Rule{
		{ID: "a", Effect: EffectAllow, WorkflowID: "wf-1", NodeID: "node-1"},
		{ID: "d", Label: "no HTTP ever", Effect: EffectDeny, NodeTypeID: "integration-http"},
		{ID: "k", Effect: EffectAsk, RequestID: "req-1"},
	}
	v := Evaluate(rules, step(), ClassExternal)
	if v.Effect != EffectDeny || v.RuleID != "d" || v.RuleLabel != "no HTTP ever" {
		t.Fatalf("verdict = %+v, want deny by rule d", v)
	}

	// Without the deny, ask wins over allow.
	v = Evaluate(rules[:1], step(), ClassExternal)
	if v.Effect != EffectAllow || v.RuleID != "a" {
		t.Fatalf("verdict = %+v, want allow by rule a", v)
	}
	v = Evaluate([]Rule{rules[0], rules[2]}, step(), ClassExternal)
	if v.Effect != EffectAsk || v.RuleID != "k" {
		t.Fatalf("verdict = %+v, want ask by rule k", v)
	}
}

func TestEvaluate_ScopeFieldsMustAllMatch(t *testing.T) {
	otherWorkflow := Rule{ID: "x", Effect: EffectDeny, WorkflowID: "wf-2"}
	if v := Evaluate([]Rule{otherWorkflow}, step(), ClassLocal); v.Effect != EffectAllow {
		t.Fatalf("rule scoped to another workflow matched: %+v", v)
	}
	bothMustMatch := Rule{ID: "y", Effect: EffectDeny, NodeTypeID: "integration-http", RequestID: "req-OTHER"}
	if v := Evaluate([]Rule{bothMustMatch}, step(), ClassLocal); v.Effect != EffectAllow {
		t.Fatalf("rule with one mismatched scope field matched: %+v", v)
	}
}

func TestEvaluate_Condition(t *testing.T) {
	r := Rule{ID: "c", Effect: EffectAllow, NodeTypeID: "integration-http",
		Condition: `Config["method"] == "GET"`}
	if v := Evaluate([]Rule{r}, step(), ClassExternal); v.Effect != EffectAllow {
		t.Fatalf("matching condition did not apply: %+v", v)
	}
	r.Condition = `Config["method"] == "DELETE"`
	if v := Evaluate([]Rule{r}, step(), ClassExternal); v.Effect != EffectAsk {
		t.Fatalf("non-matching condition applied: %+v", v)
	}
}

func TestEvaluate_BrokenConditionFailsSafe(t *testing.T) {
	// Unknown variable -> evaluation error. An allow rule must NOT
	// match (can't silently widen); a deny rule must still match
	// (can't silently disarm).
	badAllow := Rule{ID: "ba", Effect: EffectAllow, NodeTypeID: "integration-http", Condition: `NoSuchVar == 1`}
	if v := Evaluate([]Rule{badAllow}, step(), ClassExternal); v.Effect != EffectAsk {
		t.Fatalf("broken allow condition widened access: %+v", v)
	}
	badDeny := Rule{ID: "bd", Effect: EffectDeny, NodeTypeID: "integration-http", Condition: `NoSuchVar == 1`}
	if v := Evaluate([]Rule{badDeny}, step(), ClassExternal); v.Effect != EffectDeny {
		t.Fatalf("broken deny condition disarmed: %+v", v)
	}
}

func TestValidate(t *testing.T) {
	ok := Rule{ID: "r", Effect: EffectAllow, NodeTypeID: "list-lookup"}
	if err := ok.Validate(); err != nil {
		t.Fatalf("valid rule rejected: %v", err)
	}
	cases := []struct {
		rule Rule
		want string
	}{
		{Rule{Effect: "maybe", NodeTypeID: "x"}, "effect"},
		{Rule{Effect: EffectAllow}, "scope"},
		{Rule{Effect: EffectAllow, NodeID: "n"}, "workflow"},
		{Rule{Effect: EffectAllow, NodeTypeID: "x", Condition: "not a ((( expr"}, "condition"},
	}
	for _, c := range cases {
		err := c.rule.Validate()
		if err == nil || !strings.Contains(err.Error(), c.want) {
			t.Fatalf("rule %+v: err = %v, want mention of %q", c.rule, err, c.want)
		}
	}
}

func TestMayAsk(t *testing.T) {
	s := step()
	// External default asks unless an unconditional allow vouches.
	if !MayAsk(nil, s, ClassExternal) {
		t.Fatal("external with no rules should be a potential ask")
	}
	if MayAsk(nil, s, ClassLocal) {
		t.Fatal("local with no rules can never ask")
	}
	allow := Rule{ID: "a", Effect: EffectAllow, NodeTypeID: "integration-http"}
	if MayAsk([]Rule{allow}, s, ClassExternal) {
		t.Fatal("unconditional matching allow should prevent the default ask")
	}
	// A CONDITIONAL allow can't vouch -- its runtime truth is unknown.
	condAllow := allow
	condAllow.Condition = `Config["method"] == "GET"`
	if !MayAsk([]Rule{condAllow}, s, ClassExternal) {
		t.Fatal("conditional allow must not vouch against the default ask")
	}
	// A conditional ask rule counts even on a local step.
	condAsk := Rule{ID: "k", Effect: EffectAsk, NodeTypeID: "integration-http", Condition: `Attributes["amount"] > 100`}
	if !MayAsk([]Rule{condAsk}, s, ClassLocal) {
		t.Fatal("scope-matching ask rule must count regardless of condition")
	}
}
