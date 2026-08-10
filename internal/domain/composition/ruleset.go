package composition

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/alicoding/mill/internal/adapters/expression"
	"github.com/alicoding/mill/internal/domain/guardrail"
)

// Ruleset validation (docs/adr/0023): named rules evaluated against
// the data flowing through the step -- payload in, verdict out, the
// hooks shape applied to data. Distinct on purpose from Decision
// (routing) and from guardrail rules (execution policy). The data
// model adopts GoRules' JDM shape reduced to Mill's actual need (named
// rules as JSON); evaluation and authoring reuse already-adopted
// commodities (expr-lang, react-querybuilder) -- GoRules ZEN itself is
// CGO over a Rust core (disqualified by §1.1/§1.3), grule is
// sporadically maintained with its own DSL (rejected); see the ADR.

// RulesetRule is one named validation rule -- Condition is an expr-lang
// boolean over Payload/Attributes/Config, the same expression surface
// Decision edges and guardrail conditions already use.
type RulesetRule struct {
	Name      string `json:"name"`
	Condition string `json:"condition"`
}

// ParseRulesetRules decodes a ruleset node's rules config -- exported
// so save-time validation and execution share one parser.
func ParseRulesetRules(raw string) ([]RulesetRule, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	var rules []RulesetRule
	if err := json.Unmarshal([]byte(raw), &rules); err != nil {
		return nil, fmt.Errorf("ruleset: rules must be a JSON list of {name, condition}: %w", err)
	}
	return rules, nil
}

func init() {
	RegisterNodeType(NodeType{
		ID: "ruleset", Kind: KindProcess,
		Label:       "Ruleset validation",
		Description: "Validates the data flowing through this step against a set of named rules (business/data validation -- e.g. \"amount below limit\", \"country allowed\"). Every rule must pass for the payload to continue unchanged; any failing rule fails the run, naming exactly which rules failed. A rule that cannot evaluate counts as failed (fail-safe). Distinct from Decision (which routes) and from guardrail rules (which govern whether a step may execute at all).",
		Effect:      guardrail.ClassNone,
	}, func(node Node, ctx ExecContext) (ExecContext, error) {
		rules, err := ParseRulesetRules(node.Config["rulesJSON"])
		if err != nil {
			return ExecContext{}, err
		}
		env := guardrail.ConditionEnv(ctx.Payload, ctx.Attributes, node.Config)
		var failed []string
		for _, r := range rules {
			name := r.Name
			if name == "" {
				name = r.Condition
			}
			ok, err := expression.Eval(r.Condition, env)
			if err != nil || !ok {
				// An unevaluable rule counts as failed -- fail-safe, same
				// posture as guardrail conditions (docs/adr/0022).
				failed = append(failed, name)
			}
		}
		if len(failed) > 0 {
			return ExecContext{}, fmt.Errorf("ruleset: %d rule(s) failed: %s", len(failed), strings.Join(failed, ", "))
		}
		return ctx, nil
	})
}
