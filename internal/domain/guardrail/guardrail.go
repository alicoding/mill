// Package guardrail is Mill's policy core (docs/SPEC.md §8,
// docs/adr/0019 + docs/adr/0022): pure rule types and evaluation only,
// per CLAUDE.md's core-domain rule -- no storage, no DBOS, no Wails.
// Rule storage lives in guardrailservice.go; the execution gate that
// acts on a verdict lives in executionservice.go.
package guardrail

import (
	"fmt"

	"github.com/alicoding/mill/internal/adapters/expression"
)

// Effect is a rule's (or the final evaluation's) verdict. Ordered by
// precedence: deny always beats ask, ask always beats allow, no matter
// which scope a rule attaches at (ADR-0019's categorical deny-first
// resolution, modeled on Claude Code's, not Kong's specificity-wins).
type Effect string

const (
	EffectAllow Effect = "allow"
	EffectAsk   Effect = "ask"
	EffectDeny  Effect = "deny"
)

// Rule is one guardrail rule. Scope is expressed by which fields are
// set: every non-empty scope field must match the step being evaluated
// (docs/adr/0019's three scopes are all expressible -- NodeTypeID alone
// is a node-type rule, RequestID alone is a request/connector rule,
// WorkflowID+NodeID is an instance rule).
type Rule struct {
	ID     string
	Label  string
	Effect Effect
	// Scope fields -- all non-empty ones must match.
	NodeTypeID string
	RequestID  string
	WorkflowID string
	NodeID     string
	// Condition is an optional expr-lang boolean over the step's
	// evaluation environment (Payload/Attributes/Config). Empty means
	// the rule matches unconditionally within its scope.
	Condition string
}

// Validate rejects a rule that could never evaluate meaningfully --
// called at save time so a broken rule can't sit silently inert
// (the same save-time strictness ValidateGraph applies to Decision
// conditions).
func (r Rule) Validate() error {
	switch r.Effect {
	case EffectAllow, EffectAsk, EffectDeny:
	default:
		return fmt.Errorf("guardrail: rule effect must be allow, ask, or deny (got %q)", r.Effect)
	}
	if r.NodeTypeID == "" && r.RequestID == "" && r.WorkflowID == "" && r.NodeID == "" {
		return fmt.Errorf("guardrail: rule needs at least one scope (node type, request, or workflow step)")
	}
	if r.NodeID != "" && r.WorkflowID == "" {
		return fmt.Errorf("guardrail: a step-scoped rule needs its workflow too")
	}
	if r.Condition != "" {
		if err := expression.Compile(r.Condition, ConditionEnv("", nil, nil)); err != nil {
			return fmt.Errorf("guardrail: condition: %w", err)
		}
	}
	return nil
}

// ConditionEnv builds the environment a rule condition evaluates
// against -- Payload/Attributes/Config, the same variable surface
// Decision-edge conditions already use, so rule authors learn one
// expression language and one set of names.
func ConditionEnv(payload string, attributes map[string]any, config map[string]string) map[string]any {
	if attributes == nil {
		attributes = map[string]any{}
	}
	if config == nil {
		config = map[string]string{}
	}
	return map[string]any{
		"Payload":    payload,
		"Attributes": attributes,
		"Config":     config,
	}
}

// Step is what one about-to-execute step looks like to the evaluator.
type Step struct {
	NodeTypeID string
	// RequestID is the step's configured HTTPRequest reference, if any
	// (an integration-http node's requestId config).
	RequestID  string
	WorkflowID string
	NodeID     string
	// Env is the condition-evaluation environment: Payload, Attributes,
	// Config -- same shape Decision-edge conditions already evaluate
	// against, so rule authors learn one expression surface.
	Env map[string]any
}

// EffectClass is a NodeType's declared side-effect classification
// (docs/adr/0022's purity model -- also what ADR-0021's deferred shadow
// evaluation was blocked on).
type EffectClass string

const (
	// ClassNone: no I/O at all (pure transforms, in-memory lookups).
	ClassNone EffectClass = "none"
	// ClassRead: reads external state, mutates nothing.
	ClassRead EffectClass = "read"
	// ClassLocal: mutates local, user-visible state (clipboard write) --
	// the native baseline a person already performs by hand, so it
	// defaults to allow per §1's not-harder-than-baseline hard lock.
	ClassLocal EffectClass = "local"
	// ClassExternal: calls out of the machine or into another process --
	// where §8's fail-safe default bites.
	ClassExternal EffectClass = "external"
)

// DefaultEffect is the verdict when no rule matches: external steps ask,
// everything else is allowed (docs/adr/0022's table, including why
// local is deliberately not gated by default).
func DefaultEffect(class EffectClass) Effect {
	if class == ClassExternal {
		return EffectAsk
	}
	return EffectAllow
}

// Verdict is one evaluation's outcome: the effect plus which rule
// produced it (nil RuleID/RuleLabel means the effect-class default
// applied). Serialized into the run's checkpointed guardrail step, so
// the Runs UI reports what actually decided, not a re-evaluation
// against possibly-changed rules.
type Verdict struct {
	Effect Effect `json:"effect"`
	// RuleID/RuleLabel identify the deciding rule; empty when the
	// effect-class default decided.
	RuleID    string `json:"ruleID,omitempty"`
	RuleLabel string `json:"ruleLabel,omitempty"`
}

// Evaluate resolves a step against the rule set: any matching deny
// wins, else any matching ask, else any matching allow, else the
// effect class's default. A condition that fails to evaluate fails
// safe: the rule still matches if it would restrict (deny/ask), and
// doesn't if it would relax (allow).
func Evaluate(rules []Rule, step Step, class EffectClass) Verdict {
	var matched []Rule
	for _, r := range rules {
		if matches(r, step) {
			matched = append(matched, r)
		}
	}
	for _, want := range []Effect{EffectDeny, EffectAsk, EffectAllow} {
		for _, r := range matched {
			if r.Effect == want {
				return Verdict{Effect: r.Effect, RuleID: r.ID, RuleLabel: r.Label}
			}
		}
	}
	return Verdict{Effect: DefaultEffect(class)}
}

// MayAsk reports whether a step COULD park awaiting approval at run
// time -- the pre-scan RunWorkflow uses to decide blocking vs.
// non-blocking start (docs/adr/0022). Deliberately conservative about
// conditions: a condition's runtime truth is unknowable here (it reads
// the live payload), so a scope-matching ask rule counts regardless of
// its condition, and only an UNconditional matching allow can vouch
// that an ask default will never fire. Erring the other way would block
// a Run click on a 24h approval wait.
func MayAsk(rules []Rule, step Step, class EffectClass) bool {
	unconditionalAllow := false
	for _, r := range rules {
		if !scopeMatches(r, step) {
			continue
		}
		if r.Effect == EffectAsk {
			return true
		}
		if r.Effect == EffectAllow && r.Condition == "" {
			unconditionalAllow = true
		}
	}
	return DefaultEffect(class) == EffectAsk && !unconditionalAllow
}

func scopeMatches(r Rule, step Step) bool {
	return (r.NodeTypeID == "" || r.NodeTypeID == step.NodeTypeID) &&
		(r.RequestID == "" || r.RequestID == step.RequestID) &&
		(r.WorkflowID == "" || r.WorkflowID == step.WorkflowID) &&
		(r.NodeID == "" || r.NodeID == step.NodeID)
}

func matches(r Rule, step Step) bool {
	if r.NodeTypeID != "" && r.NodeTypeID != step.NodeTypeID {
		return false
	}
	if r.RequestID != "" && r.RequestID != step.RequestID {
		return false
	}
	if r.WorkflowID != "" && r.WorkflowID != step.WorkflowID {
		return false
	}
	if r.NodeID != "" && r.NodeID != step.NodeID {
		return false
	}
	if r.Condition == "" {
		return true
	}
	ok, err := expression.Eval(r.Condition, step.Env)
	if err != nil {
		// Fail safe (docs/adr/0022): a broken condition can't silently
		// widen an allow or silently disarm a deny/ask.
		return r.Effect != EffectAllow
	}
	return ok
}
