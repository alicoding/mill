package guardrailsvc

import (
	"encoding/json"
	"fmt"
	"sync"

	"github.com/alicoding/mill/internal/adapters/settings"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/guardrail"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/google/uuid"
)

// guardrailRulesKey mirrors workflowsKey/listsKey's shape: one JSON
// array under one settings key.
const guardrailRulesKey = "guardrail-rules"

// GuardrailService is the Wails-facing layer over
// internal/domain/guardrail -- rule storage/CRUD plus the dry-run
// tester §8 locks as a requirement ("a policy rule that's silently
// broader than intended is exactly how a guardrail fails quietly").
// Evaluation itself stays in the domain package; the execution gate
// that acts on a verdict lives in executionservice.go.
type GuardrailService struct {
	mu    sync.RWMutex
	store settings.Store
	rules []guardrail.Rule
	comp  *compositionsvc.CompositionService
}

func NewGuardrailService(store settings.Store, comp *compositionsvc.CompositionService) *GuardrailService {
	g := &GuardrailService{store: store, comp: comp}
	g.restore()
	return g
}

func (g *GuardrailService) restore() {
	if raw, ok := g.store.Get(guardrailRulesKey).(string); ok && raw != "" {
		var rules []guardrail.Rule
		if err := json.Unmarshal([]byte(raw), &rules); err == nil {
			g.rules = rules
		}
	}
}

func (g *GuardrailService) persist() {
	data, err := json.Marshal(g.rules)
	if err != nil {
		return
	}
	_ = g.store.Set(guardrailRulesKey, string(data))
}

// Rules returns every stored rule.
func (g *GuardrailService) Rules() []guardrail.Rule {
	g.mu.RLock()
	defer g.mu.RUnlock()
	out := make([]guardrail.Rule, len(g.rules))
	copy(out, g.rules)
	return out
}

// CreateRule validates and stores a new rule, minting its ID.
func (g *GuardrailService) CreateRule(rule guardrail.Rule) (guardrail.Rule, error) {
	rule.ID = uuid.NewString()
	if err := rule.Validate(); err != nil {
		return guardrail.Rule{}, err
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	g.rules = append(g.rules, rule)
	g.persist()
	return rule, nil
}

// UpdateRule replaces an existing rule in place, same validation as
// create.
func (g *GuardrailService) UpdateRule(rule guardrail.Rule) error {
	if err := rule.Validate(); err != nil {
		return err
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	for i, r := range g.rules {
		if r.ID == rule.ID {
			g.rules[i] = rule
			g.persist()
			return nil
		}
	}
	return fmt.Errorf("unknown guardrail rule: %s", rule.ID)
}

// DeleteRule removes a rule by ID; deleting an absent rule is a no-op,
// matching every other Configure entity's delete semantics.
func (g *GuardrailService) DeleteRule(id string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	kept := g.rules[:0]
	for _, r := range g.rules {
		if r.ID != id {
			kept = append(kept, r)
		}
	}
	g.rules = kept
	g.persist()
}

// RuleTestResult is one dry-run's outcome for the Configure tester.
type RuleTestResult struct {
	Effect    string `json:"effect"`
	RuleID    string `json:"ruleID"`
	RuleLabel string `json:"ruleLabel"`
	// EffectClass is the tested node type's declared side-effect class,
	// so the tester can explain a default verdict ("external steps ask
	// by default").
	EffectClass string `json:"effectClass"`
}

// TestRules dry-runs the current rule set against one real workflow
// step -- §8's locked testability requirement: see what would happen
// before trusting a rule live. Uses the node's stored config and the
// workflow's zero-valued attributes, the same environment shape the
// live gate evaluates.
func (g *GuardrailService) TestRules(workflowID, nodeID string) (RuleTestResult, error) {
	var target *composition.Node
	var wf composition.Workflow
	for _, w := range g.comp.Workflows() {
		if w.ID == workflowID {
			wf = w
			for i := range w.Nodes {
				if w.Nodes[i].ID == nodeID {
					target = &w.Nodes[i]
				}
			}
		}
	}
	if target == nil {
		return RuleTestResult{}, fmt.Errorf("unknown workflow step: %s / %s", workflowID, nodeID)
	}
	// The explicit checkpoint always parks -- report it as such rather
	// than evaluating rules its park deliberately ignores (same
	// special-case as WorkflowVerdicts below).
	if target.NodeTypeID == "human-review" {
		return RuleTestResult{Effect: "ask", RuleLabel: "explicit checkpoint", EffectClass: "none"}, nil
	}
	class := composition.NodeTypeEffect(target.NodeTypeID)
	verdict := guardrail.Evaluate(g.Rules(), GuardrailStep(workflowID, *target, composition.ExecContext{
		Attributes: composition.AttributesEnv(wf.Attributes, nil),
	}), class)
	return RuleTestResult{
		Effect:      string(verdict.Effect),
		RuleID:      verdict.RuleID,
		RuleLabel:   verdict.RuleLabel,
		EffectClass: string(class),
	}, nil
}

// GuardrailStep converts one about-to-execute node into the domain
// evaluator's Step shape -- shared by the live gate
// (executionsvc) and the dry-run tester above, so a
// test verdict can never diverge from the live one by construction.
func GuardrailStep(workflowID string, node composition.Node, ec composition.ExecContext) guardrail.Step {
	return guardrail.Step{
		NodeTypeID: node.NodeTypeID,
		RequestID:  node.Config["requestId"],
		WorkflowID: workflowID,
		NodeID:     node.ID,
		Env:        guardrail.ConditionEnv(ec.Payload, ec.Attributes, node.Config),
	}
}

// WorkflowVerdicts dry-runs the current rule set against every
// executable step of one workflow at once -- the canvas's
// nothing-hidden badge data (docs/adr/0022's Update: a step that will
// ask or deny is marked visibly on the canvas BEFORE anyone runs it,
// not discovered at run time). The explicit Wait-for-approval node
// always reports ask -- it parks by construction, no rule vouches it
// away.
func (g *GuardrailService) WorkflowVerdicts(workflowID string) (map[string]RuleTestResult, error) {
	var wf composition.Workflow
	found := false
	for _, w := range g.comp.Workflows() {
		if w.ID == workflowID {
			wf = w
			found = true
		}
	}
	if !found {
		return nil, fmt.Errorf("unknown workflow: %s", workflowID)
	}
	out := make(map[string]RuleTestResult)
	rules := g.Rules()
	attrs := composition.AttributesEnv(wf.Attributes, nil)
	for _, n := range wf.Nodes {
		if n.Kind == composition.KindTrigger || n.Kind == composition.KindDecision {
			continue
		}
		if n.NodeTypeID == "human-review" {
			out[n.ID] = RuleTestResult{Effect: "ask", RuleLabel: "explicit checkpoint", EffectClass: "none"}
			continue
		}
		class := composition.NodeTypeEffect(n.NodeTypeID)
		v := guardrail.Evaluate(rules, GuardrailStep(workflowID, n, composition.ExecContext{Attributes: attrs}), class)
		out[n.ID] = RuleTestResult{
			Effect: string(v.Effect), RuleID: v.RuleID, RuleLabel: v.RuleLabel, EffectClass: string(class),
		}
	}
	return out, nil
}
